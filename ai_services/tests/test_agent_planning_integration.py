from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from domain.operations.agent_service import AgentPlanningService
from domain.operations.agent_workflow import (
    AGENT_DEFINITIONS,
    AgentToolRegistry,
    MachineRiskItem,
    MachineRiskReport,
    ResourceReport,
    SpecialistNarrative,
    create_openrouter_chat_model,
    run_llm_agent_workflow,
    run_specialist_analysis,
    verify_narrative_grounding,
)
from domain.operations.contracts import (
    AgentRole,
    RunDecisionCaseRequest,
    TimeWindow,
    ValidationVerdict,
)
from domain.operations.service import NoFeasiblePlan


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_REQUEST = (
    REPOSITORY_ROOT / "contracts" / "v3" / "fixtures" / "demo-health-alert.json"
)


def _request() -> RunDecisionCaseRequest:
    return RunDecisionCaseRequest.model_validate_json(
        CANONICAL_REQUEST.read_text(encoding="utf-8")
    )


class _FakeStructuredRunnable:
    def __init__(self, schema: type[SpecialistNarrative]) -> None:
        self.schema = schema

    def invoke(self, messages):
        payload = json.loads(messages[-1].content)
        return self.schema(
            summary="Evidence reviewed.",
            findings=["No unsupported claim was added."],
            evidence_refs=payload["allowed_evidence_refs"][:1],
        )


class _FakeChatModel:
    def with_structured_output(self, schema):
        return _FakeStructuredRunnable(schema)


def test_specialists_are_read_only_and_tool_scoped() -> None:
    assert {agent.role for agent in AGENT_DEFINITIONS} == {
        AgentRole.SUPERVISOR,
        AgentRole.PDM,
        AgentRole.TECHNICIAN_DISPATCH,
        AgentRole.PRODUCTION_SCHEDULING,
    }
    pdm = next(agent for agent in AGENT_DEFINITIONS if agent.role is AgentRole.PDM)
    with pytest.raises(PermissionError, match="not allowed"):
        AgentToolRegistry().invoke(
            pdm,
            "check_technician_eligibility",
            _request().factory_snapshot,
        )


def test_resource_agent_finds_later_slot_inside_maintenance_window() -> None:
    request = _request()
    snapshot = request.factory_snapshot
    maintenance = snapshot.maintenance_requests[0]
    delayed_start = maintenance.earliest_start_at.replace(hour=2)
    technicians = [
        technician.model_copy(
            update={
                "availability": [
                    TimeWindow(
                        start_at=delayed_start,
                        end_at=snapshot.planning_window.end_at,
                    )
                ]
            }
        )
        if technician.technician_id == "T01"
        else technician
        for technician in snapshot.technicians
    ]
    delayed_snapshot = snapshot.model_copy(update={"technicians": technicians})

    result = run_specialist_analysis(delayed_snapshot, "case-delayed-technician")
    resources = result.reports["resource-specialist"]

    assert isinstance(resources, ResourceReport)
    match = resources.matches[0]
    assert match.unstaffed is False
    assert match.eligible_technician_teams == [["T01"]]
    assert match.earliest_feasible_start_at == delayed_start
    assert match.earliest_feasible_end_at > delayed_start


def test_grounding_rejects_numeric_hallucination_and_accepts_percentage() -> None:
    report = MachineRiskReport(
        items=[
            MachineRiskItem(
                machine_id="M03",
                health_snapshot_id="health-M03-001",
                failure_probability=0.42,
                horizon_minutes=480,
                confidence="HIGH",
                model_version="rul-demo-v1",
            )
        ],
        evidence_refs=["health-M03-001"],
    )
    grounded = SpecialistNarrative(
        summary="Failure probability is 42 percent within 480 minutes.",
        findings=[],
        evidence_refs=["health-M03-001"],
    )
    verify_narrative_grounding(grounded, report, report.evidence_refs)

    hallucinated = grounded.model_copy(
        update={"summary": "Failure probability is 99 percent."}
    )
    with pytest.raises(ValueError, match="ungrounded numeric claims"):
        verify_narrative_grounding(hallucinated, report, report.evidence_refs)

    invalid_citation = grounded.model_copy(
        update={"evidence_refs": ["invented-evidence"]}
    )
    with pytest.raises(ValueError, match="cited evidence outside"):
        verify_narrative_grounding(invalid_citation, report, report.evidence_refs)


def test_openrouter_runtime_has_bounded_retry_and_timeout(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-not-used-for-network")
    monkeypatch.setenv("OPENROUTER_MODEL", "provider/test-model")
    monkeypatch.setenv("OPENROUTER_MAX_RETRIES", "99")
    monkeypatch.setenv("OPENROUTER_TIMEOUT_MS", "500")

    model = create_openrouter_chat_model()

    assert model.max_retries == 3
    assert model.request_timeout == 1_000


def test_fake_llm_workflow_is_grounded_and_observable() -> None:
    result = run_llm_agent_workflow(
        _request().factory_snapshot,
        decision_case_id="case-grounded-llm",
        model=_FakeChatModel(),
    )

    assert result["status"] == "READY_FOR_PLANNING"
    assert len(result["tool_calls"]) == 3
    assert result["metrics"]["tool_call_count"] == 3
    assert result["metrics"]["tool_failure_count"] == 0
    assert result["metrics"]["grounded_narrative_count"] == 4


def test_agent_planning_runs_analysis_then_validated_deterministic_planner() -> None:
    service = AgentPlanningService()
    first = service.plan_with_analysis(_request())
    second = service.plan_with_analysis(_request())

    assert first.recommendation.model_dump_json() == second.recommendation.model_dump_json()
    assert len(first.recommendation.candidate_plans) == 3
    assert all(
        plan.validation is not None
        and plan.validation.verdict is ValidationVerdict.VALID
        for plan in first.recommendation.candidate_plans
    )
    assert all(
        plan.source_agent_run_ids
        == [
            "run-pdm-specialist",
            "run-production-impact-specialist",
            "run-resource-specialist",
        ]
        for plan in first.recommendation.candidate_plans
    )
    assert first.diagnostics.rejected_plan_ids == []
    assert first.metrics.feasible_candidate_count == 3
    assert first.metrics.candidate_feasibility_rate == 1.0
    assert first.metrics.tool_failure_rate == 0.0


def test_agent_planning_does_not_hide_missing_technician() -> None:
    request = _request()
    no_technician = request.model_copy(
        update={
            "factory_snapshot": request.factory_snapshot.model_copy(
                update={"technicians": []}
            )
        }
    )

    analysis = run_specialist_analysis(no_technician.factory_snapshot)
    assert AgentPlanningService.unstaffed_request_ids(analysis) == ["MR-M03-001"]
    with pytest.raises(NoFeasiblePlan, match="qualified technician"):
        AgentPlanningService().plan(no_technician)


def test_agent_api_returns_render_ready_plan_and_structured_failures(monkeypatch) -> None:
    import main

    client = TestClient(main.app, raise_server_exceptions=False)
    request = _request()

    analysis = client.post(
        "/internal/v1/operations/agent-analysis",
        json={
            "decision_case_id": request.decision_case_id,
            "snapshot": request.factory_snapshot.model_dump(mode="json"),
        },
    )
    assert analysis.status_code == 200
    assert analysis.json()["policy_status"] == "DETERMINISTIC_PLANNER_AVAILABLE"
    assert analysis.json()["metrics"]["tool_call_count"] == 3

    planned = client.post(
        "/v1/operations/agent-plan",
        json=request.model_dump(mode="json"),
    )
    assert planned.status_code == 200
    assert planned.json()["recommended_plan_id"]

    monkeypatch.setattr(
        main,
        "run_specialist_analysis",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("secret traceback")),
    )
    failed = client.post(
        "/internal/v1/operations/agent-analysis",
        json={
            "decision_case_id": request.decision_case_id,
            "snapshot": request.factory_snapshot.model_dump(mode="json"),
        },
    )
    assert failed.status_code == 500
    assert failed.json()["code"] == "INTERNAL_SERVICE_ERROR"
    assert "secret traceback" not in failed.text
