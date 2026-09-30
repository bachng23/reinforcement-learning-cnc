from __future__ import annotations

import json
import itertools
import operator
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Callable, TypedDict

from pydantic import BaseModel, ConfigDict

from domain.operations.contracts import (
    AgentDefinition,
    AgentRole,
    AssignmentStatus,
    AssignmentType,
    DecisionEvent,
    DecisionEventType,
    FactorySnapshot,
    ToolDefinition,
    ToolSideEffect,
    ToolCallStatus,
    ToolCallTrace,
)


class _Output(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MachineRiskItem(_Output):
    machine_id: str
    health_snapshot_id: str
    failure_probability: float
    horizon_minutes: int
    confidence: str
    model_version: str


class MachineRiskReport(_Output):
    items: list[MachineRiskItem]
    evidence_refs: list[str]


class TechnicianMatch(_Output):
    maintenance_request_id: str
    machine_id: str
    eligible_technician_ids: list[str]
    eligible_technician_teams: list[list[str]]
    earliest_feasible_start_at: datetime | None = None
    earliest_feasible_end_at: datetime | None = None
    unstaffed: bool


class ResourceReport(_Output):
    matches: list[TechnicianMatch]
    available_technician_count: int
    evidence_refs: list[str]


class ProductionImpactReport(_Output):
    affected_operation_ids: list[str]
    affected_job_ids: list[str]
    assignments_on_maintenance_machines: int
    evidence_refs: list[str]


class SpecialistNarrative(_Output):
    summary: str
    findings: list[str]
    evidence_refs: list[str]


class AgentRunMetrics(_Output):
    duration_ms: int
    tool_call_count: int
    tool_failure_count: int
    tool_failure_rate: float
    grounded_narrative_count: int
    grounded_narrative_rate: float | None = None


@dataclass(frozen=True)
class _Tool:
    definition: ToolDefinition
    handler: Callable[[FactorySnapshot], _Output]


def _overlaps(
    start_at: datetime,
    end_at: datetime,
    occupied_window: tuple[datetime, datetime],
) -> bool:
    occupied_start, occupied_end = occupied_window
    return start_at < occupied_end and occupied_start < end_at


def _qualified_teams(snapshot: FactorySnapshot, request, machine) -> list[tuple[str, ...]]:
    candidates = [
        technician
        for technician in snapshot.technicians
        if technician.status.value not in {"OFF_SHIFT", "UNAVAILABLE"}
        and any(
            skill.skill_id in request.required_skill_ids
            and skill.level >= request.minimum_skill_level
            and machine.machine_family in skill.certified_machine_families
            and request.action_type in skill.certified_action_types
            for skill in technician.skills
        )
    ]
    teams: list[tuple[str, ...]] = []
    for size in range(1, len(candidates) + 1):
        for group in itertools.combinations(candidates, size):
            covered = {
                skill.skill_id
                for technician in group
                for skill in technician.skills
                if skill.level >= request.minimum_skill_level
                and machine.machine_family in skill.certified_machine_families
                and request.action_type in skill.certified_action_types
            }
            if set(request.required_skill_ids).issubset(covered):
                teams.append(tuple(technician.technician_id for technician in group))
        if teams:
            break
    return sorted(teams)


def _availability_start(technician, start_at: datetime, duration: timedelta):
    for window in sorted(technician.availability, key=lambda item: item.start_at):
        candidate = max(start_at, window.start_at)
        if candidate + duration <= window.end_at:
            return candidate
    return None


def _find_team_slot(
    technicians,
    team: tuple[str, ...],
    occupied: dict[str, list[tuple[datetime, datetime]]],
    earliest: datetime,
    latest_start: datetime,
    duration: timedelta,
) -> tuple[datetime, datetime] | None:
    start_at = earliest
    while start_at <= latest_start:
        while True:
            next_start = start_at
            for technician_id in team:
                available_start = _availability_start(
                    technicians[technician_id], next_start, duration
                )
                if available_start is None:
                    return None
                next_start = max(next_start, available_start)
            if next_start == start_at:
                break
            start_at = next_start
        end_at = start_at + duration
        conflicts = [
            window
            for technician_id in team
            for window in occupied.get(technician_id, [])
            if _overlaps(start_at, end_at, window)
        ]
        if not conflicts:
            return (start_at, end_at) if start_at <= latest_start else None
        start_at = max(window[1] for window in conflicts)
    return None


def _eligible_technicians(snapshot: FactorySnapshot) -> ResourceReport:
    technicians = {tech.technician_id: tech for tech in snapshot.technicians}
    machines = {machine.machine_id: machine for machine in snapshot.machines}
    occupied: dict[str, list[tuple[datetime, datetime]]] = {}
    if snapshot.current_schedule is not None:
        for assignment in snapshot.current_schedule.assignments:
            if (
                assignment.assignment_type is AssignmentType.MAINTENANCE
                and assignment.status
                in {AssignmentStatus.PROPOSED, AssignmentStatus.COMMITTED, AssignmentStatus.RUNNING}
            ):
                for technician_id in assignment.technician_ids:
                    occupied.setdefault(technician_id, []).append(
                        (assignment.start_at, assignment.end_at)
                    )
    matches: list[TechnicianMatch] = []
    for request in snapshot.maintenance_requests:
        machine = machines[request.machine_id]
        duration = timedelta(minutes=request.expected_duration_minutes)
        earliest = max(request.earliest_start_at, snapshot.planning_window.start_at)
        latest_start = min(
            request.latest_start_at or snapshot.planning_window.end_at - duration,
            snapshot.planning_window.end_at - duration,
        )
        feasible: list[tuple[datetime, datetime, tuple[str, ...]]] = []
        for team in _qualified_teams(snapshot, request, machine):
            slot = _find_team_slot(
                technicians, team, occupied, earliest, latest_start, duration
            )
            if slot is not None:
                feasible.append((slot[0], slot[1], team))
        feasible.sort(key=lambda item: (item[0], item[2]))
        eligible = sorted({technician_id for _, _, team in feasible for technician_id in team})
        first = feasible[0] if feasible else None
        matches.append(
            TechnicianMatch(
                maintenance_request_id=request.maintenance_request_id,
                machine_id=request.machine_id,
                eligible_technician_ids=eligible,
                eligible_technician_teams=[list(team) for _, _, team in feasible],
                earliest_feasible_start_at=first[0] if first else None,
                earliest_feasible_end_at=first[1] if first else None,
                unstaffed=not feasible,
            )
        )
    return ResourceReport(
        matches=matches,
        available_technician_count=sum(
            tech.status.value not in {"OFF_SHIFT", "UNAVAILABLE"}
            for tech in technicians.values()
        ),
        evidence_refs=[request.maintenance_request_id for request in snapshot.maintenance_requests]
        or [snapshot.snapshot_id],
    )


def _machine_risk(snapshot: FactorySnapshot) -> MachineRiskReport:
    items = [
        MachineRiskItem(
            machine_id=health.machine_id,
            health_snapshot_id=health.health_snapshot_id,
            failure_probability=health.failure_probability,
            horizon_minutes=health.failure_probability_horizon_minutes,
            confidence=health.confidence,
            model_version=health.source_model_version,
        )
        for health in snapshot.health_snapshots
    ]
    return MachineRiskReport(
        items=items,
        evidence_refs=[item.health_snapshot_id for item in items] or [snapshot.snapshot_id],
    )


def _production_impact(snapshot: FactorySnapshot) -> ProductionImpactReport:
    target_machines = {request.machine_id for request in snapshot.maintenance_requests}
    assignments = (
        snapshot.current_schedule.assignments if snapshot.current_schedule is not None else []
    )
    affected = [
        assignment
        for assignment in assignments
        if assignment.machine_id in target_machines
        and assignment.operation_id is not None
    ]
    return ProductionImpactReport(
        affected_operation_ids=sorted({a.operation_id for a in affected if a.operation_id}),
        affected_job_ids=sorted({a.job_id for a in affected if a.job_id}),
        assignments_on_maintenance_machines=len(affected),
        evidence_refs=[snapshot.current_schedule.schedule_id]
        if snapshot.current_schedule is not None
        else [snapshot.snapshot_id],
    )


def _tool(
    tool_id: str,
    description: str,
    roles: list[AgentRole],
    handler: Callable[[FactorySnapshot], _Output],
) -> _Tool:
    return _Tool(
        definition=ToolDefinition(
            tool_id=tool_id,
            version="1.0.0",
            description=description,
            owner_service="ai-services",
            input_schema_ref="operations.FactorySnapshot",
            output_schema_ref=f"operations.{tool_id}.output",
            timeout_ms=2000,
            side_effect=ToolSideEffect.NONE,
            allowed_agent_roles=roles,
        ),
        handler=handler,
    )


_SPECIALISTS = [
    AgentDefinition(
        agent_id="decision-supervisor",
        version="1.0.0",
        role=AgentRole.SUPERVISOR,
        display_name="Supervisor Agent",
        goal="Coordinate specialist evidence for deterministic planning; never commit without human approval.",
        allowed_tool_ids=[],
        timeout_seconds=30,
        max_tool_calls=1,
    ),
    AgentDefinition(
        agent_id="pdm-specialist",
        version="1.0.0",
        role=AgentRole.PDM,
        display_name="PdM Agent",
        goal="Report machine health evidence without changing model predictions.",
        allowed_tool_ids=["read_machine_health"],
        timeout_seconds=10,
        max_tool_calls=1,
    ),
    AgentDefinition(
        agent_id="resource-specialist",
        version="1.0.0",
        role=AgentRole.TECHNICIAN_DISPATCH,
        display_name="Resource Agent",
        goal="Find technicians meeting skill, certification, status, and availability constraints.",
        allowed_tool_ids=["check_technician_eligibility"],
        timeout_seconds=10,
        max_tool_calls=1,
    ),
    AgentDefinition(
        agent_id="production-impact-specialist",
        version="1.0.0",
        role=AgentRole.PRODUCTION_SCHEDULING,
        display_name="Production Impact Agent",
        goal="Identify scheduled operations on machines with open maintenance requests.",
        allowed_tool_ids=["inspect_production_impact"],
        timeout_seconds=10,
        max_tool_calls=1,
    ),
]

_TOOLS = {
    item.definition.tool_id: item
    for item in [
        _tool(
            "read_machine_health",
            "Read recorded health estimates and their source model versions.",
            [AgentRole.PDM],
            _machine_risk,
        ),
        _tool(
            "check_technician_eligibility",
            "Check technician status, skills, certifications, and availability.",
            [AgentRole.TECHNICIAN_DISPATCH],
            _eligible_technicians,
        ),
        _tool(
            "inspect_production_impact",
            "List current production assignments on machines with open maintenance requests.",
            [AgentRole.PRODUCTION_SCHEDULING],
            _production_impact,
        ),
    ]
}

AGENT_DEFINITIONS = tuple(_SPECIALISTS)
TOOL_DEFINITIONS = tuple(tool.definition for tool in _TOOLS.values())


class AgentToolRegistry:
    """Read-only tool registry with an enforced per-agent allowlist."""

    def invoke(
        self, agent: AgentDefinition, tool_id: str, snapshot: FactorySnapshot
    ) -> _Output:
        if tool_id not in agent.allowed_tool_ids:
            raise PermissionError(f"agent {agent.agent_id} is not allowed to call {tool_id}")
        tool = _TOOLS.get(tool_id)
        if tool is None:
            raise KeyError(f"unknown tool: {tool_id}")
        if agent.role not in tool.definition.allowed_agent_roles:
            raise PermissionError(f"role {agent.role.value} cannot call {tool_id}")
        return tool.handler(snapshot)


@dataclass(frozen=True)
class AgentWorkflowResult:
    status: str
    reports: dict[str, _Output]
    tool_calls: tuple[ToolCallTrace, ...]
    events: tuple[DecisionEvent, ...]
    metrics: AgentRunMetrics


_MODEL_GATE = threading.BoundedSemaphore(value=4)
_STANDALONE_NUMBER = re.compile(
    r"(?<![A-Za-z0-9_.-])-?\d+(?:\.\d+)?(?![A-Za-z0-9_.-])"
)


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    return min(max(value, minimum), maximum)


def create_openrouter_chat_model():
    from dotenv import load_dotenv
    from langchain_openrouter import ChatOpenRouter

    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    api_key = os.environ.get("OPENROUTER_API_KEY")
    model = os.environ.get("OPENROUTER_MODEL")
    if not api_key or not model:
        raise RuntimeError(
            "Configure OPENROUTER_API_KEY and OPENROUTER_MODEL in ai_services/.env"
        )
    return ChatOpenRouter(
        model=model,
        api_key=api_key,
        temperature=0,
        timeout=_bounded_env_int("OPENROUTER_TIMEOUT_MS", 25_000, 1_000, 60_000),
        max_retries=_bounded_env_int("OPENROUTER_MAX_RETRIES", 2, 0, 3),
    )


def _numeric_values(value) -> set[float]:
    values: set[float] = set()
    if value is None:
        return values
    if isinstance(value, bool):
        values.add(float(value))
        return values
    if isinstance(value, (int, float)):
        number = float(value)
        values.add(number)
        if 0 <= number <= 1:
            values.add(number * 100)
        return values
    if isinstance(value, dict):
        values.add(float(len(value)))
        for nested in value.values():
            values.update(_numeric_values(nested))
    elif isinstance(value, (list, tuple)):
        values.add(float(len(value)))
        for nested in value:
            values.update(_numeric_values(nested))
    return values


def verify_narrative_grounding(
    narrative: SpecialistNarrative,
    report: _Output | dict,
    allowed_evidence_refs: list[str],
) -> None:
    """Reject citations and standalone numeric claims not present in tool output."""
    if not set(narrative.evidence_refs).issubset(set(allowed_evidence_refs)):
        raise ValueError("narrative cited evidence outside its tool output")
    payload = report.model_dump(mode="json") if isinstance(report, BaseModel) else report
    allowed_numbers = _numeric_values(payload)
    narrative_text = " ".join([narrative.summary, *narrative.findings])
    claimed_numbers = {float(value) for value in _STANDALONE_NUMBER.findall(narrative_text)}
    unsupported = sorted(
        value
        for value in claimed_numbers
        if not any(abs(value - allowed) <= 1e-9 for allowed in allowed_numbers)
    )
    if unsupported:
        raise ValueError(f"narrative contains ungrounded numeric claims: {unsupported}")


def _invoke_structured(chat_model, schema, prompt):
    wait_seconds = _bounded_env_int(
        "OPENROUTER_QUEUE_TIMEOUT_SECONDS", 30, 1, 120
    )
    if not _MODEL_GATE.acquire(timeout=wait_seconds):
        raise TimeoutError("LLM concurrency limit queue timed out")
    try:
        return chat_model.with_structured_output(schema).invoke(prompt)
    finally:
        _MODEL_GATE.release()


def _merge_dicts(left: dict, right: dict) -> dict:
    return {**left, **right}


class LLMWorkflowState(TypedDict):
    decision_case_id: str
    snapshot: FactorySnapshot
    reports: Annotated[dict[str, dict], _merge_dicts]
    narratives: Annotated[dict[str, dict], _merge_dicts]
    tool_calls: Annotated[list[dict], operator.add]
    events: Annotated[list[dict], operator.add]
    supervisor_summary: dict
    status: str


def build_langgraph_agent_workflow(snapshot: FactorySnapshot, model=None):
    """Build the tool-scoped LLM workflow; inject a chat model in tests."""
    from langchain_core.messages import HumanMessage, SystemMessage
    from langgraph.graph import END, START, StateGraph

    chat_model = model or create_openrouter_chat_model()
    registry = AgentToolRegistry()
    analysis_agents = _SPECIALISTS[1:]

    def specialist_node(agent: AgentDefinition):
        def run(state: LLMWorkflowState) -> dict:
            tool_id = agent.allowed_tool_ids[0]
            run_id = f"{state['decision_case_id']}-run-{agent.agent_id}"
            call_id = f"{state['decision_case_id']}-tool-{agent.agent_id}"
            agent_started_at = datetime.now(timezone.utc)
            tool_started_at = datetime.now(timezone.utc)
            report = registry.invoke(agent, tool_id, state["snapshot"])
            tool_completed_at = datetime.now(timezone.utc)
            if tool_completed_at <= tool_started_at:
                tool_completed_at = tool_started_at + timedelta(microseconds=1)
            evidence_refs = list(getattr(report, "evidence_refs", []))
            prompt = [
                SystemMessage(
                    content=(
                        f"You are {agent.display_name}. {agent.goal} Summarize only "
                        "the supplied tool output. Do not change or invent numeric values. "
                        "Return evidence_refs using only exact IDs from the evidence list."
                    )
                ),
                HumanMessage(
                    content=json.dumps(
                        {
                            "decision_case_id": state["decision_case_id"],
                            "tool_id": tool_id,
                            "tool_output": report.model_dump(mode="json"),
                            "allowed_evidence_refs": evidence_refs,
                        },
                        sort_keys=True,
                    )
                ),
            ]
            narrative_result = _invoke_structured(
                chat_model, SpecialistNarrative, prompt
            )
            narrative = (
                narrative_result
                if isinstance(narrative_result, SpecialistNarrative)
                else SpecialistNarrative.model_validate(narrative_result)
            )
            verify_narrative_grounding(narrative, report, evidence_refs)
            trace = ToolCallTrace(
                tool_call_id=call_id,
                decision_case_id=state["decision_case_id"],
                agent_run_id=run_id,
                correlation_id=state["decision_case_id"],
                tool_id=tool_id,
                tool_version=_TOOLS[tool_id].definition.version,
                status=ToolCallStatus.SUCCEEDED,
                started_at=tool_started_at,
                completed_at=tool_completed_at,
                input_summary={"snapshot_id": state["snapshot"].snapshot_id},
                output_summary=report.model_dump(mode="json"),
                evidence_refs=evidence_refs,
            )
            agent_completed_at = datetime.now(timezone.utc)
            if agent_completed_at <= tool_completed_at:
                agent_completed_at = tool_completed_at + timedelta(microseconds=1)
            trace_events = [
                DecisionEvent(
                    event_id=f"{run_id}-started", sequence=0,
                    decision_case_id=state["decision_case_id"],
                    event_type=DecisionEventType.AGENT_STARTED,
                    occurred_at=agent_started_at, subject_id=run_id,
                    correlation_id=state["decision_case_id"],
                    payload={"agent_id": agent.agent_id, "role": agent.role.value},
                ),
                DecisionEvent(
                    event_id=f"{call_id}-started", sequence=0,
                    decision_case_id=state["decision_case_id"],
                    event_type=DecisionEventType.TOOL_STARTED,
                    occurred_at=tool_started_at, subject_id=call_id,
                    correlation_id=state["decision_case_id"],
                    payload={"agent_run_id": run_id, "tool_id": tool_id},
                ),
                DecisionEvent(
                    event_id=f"{call_id}-completed", sequence=0,
                    decision_case_id=state["decision_case_id"],
                    event_type=DecisionEventType.TOOL_COMPLETED,
                    occurred_at=tool_completed_at, subject_id=call_id,
                    correlation_id=state["decision_case_id"],
                    payload={"agent_run_id": run_id, "tool_id": tool_id,
                             "tool_call_id": call_id, "status": ToolCallStatus.SUCCEEDED.value,
                             "evidence_refs": evidence_refs},
                ),
                DecisionEvent(
                    event_id=f"{run_id}-completed", sequence=0,
                    decision_case_id=state["decision_case_id"],
                    event_type=DecisionEventType.AGENT_COMPLETED,
                    occurred_at=agent_completed_at, subject_id=run_id,
                    correlation_id=state["decision_case_id"],
                    payload={"agent_id": agent.agent_id, "tool_id": tool_id},
                ),
            ]
            return {
                "reports": {agent.agent_id: report.model_dump(mode="json")},
                "narratives": {agent.agent_id: narrative.model_dump(mode="json")},
                "tool_calls": [trace.model_dump(mode="json")],
                "events": [event.model_dump(mode="json") for event in trace_events],
            }

        return run

    def supervisor_node(state: LLMWorkflowState) -> dict:
        supervisor = _SPECIALISTS[0]
        run_id = f"{state['decision_case_id']}-run-{supervisor.agent_id}"
        started_at = datetime.now(timezone.utc)
        evidence_refs = sorted(
            {
                ref
                for narrative in state["narratives"].values()
                for ref in narrative["evidence_refs"]
            }
        )
        prompt = [
            SystemMessage(
                content=(
                    "You are the decision Supervisor. Summarize specialist evidence "
                    "for handoff to the deterministic planning engine. Do not choose an action, "
                    "declare feasibility, or recommend approval. Cite only supplied IDs."
                )
            ),
            HumanMessage(
                content=json.dumps(
                    {
                        "specialist_summaries": state["narratives"],
                        "allowed_evidence_refs": evidence_refs,
                    },
                    sort_keys=True,
                )
            ),
        ]
        result = _invoke_structured(chat_model, SpecialistNarrative, prompt)
        summary = (
            result
            if isinstance(result, SpecialistNarrative)
            else SpecialistNarrative.model_validate(result)
        )
        verify_narrative_grounding(
            summary,
            {"reports": state["reports"], "narratives": state["narratives"]},
            evidence_refs,
        )
        completed_at = datetime.now(timezone.utc)
        if completed_at <= started_at:
            completed_at = started_at + timedelta(microseconds=1)
        events = [
            DecisionEvent(
                event_id=f"{run_id}-started", sequence=0,
                decision_case_id=state["decision_case_id"],
                event_type=DecisionEventType.AGENT_STARTED,
                occurred_at=started_at, subject_id=run_id,
                correlation_id=state["decision_case_id"],
                payload={"agent_id": supervisor.agent_id, "role": supervisor.role.value},
            ),
            DecisionEvent(
                event_id=f"{run_id}-completed", sequence=0,
                decision_case_id=state["decision_case_id"],
                event_type=DecisionEventType.AGENT_COMPLETED,
                occurred_at=completed_at, subject_id=run_id,
                correlation_id=state["decision_case_id"],
                payload={"agent_id": supervisor.agent_id},
            ),
        ]
        return {
            "supervisor_summary": summary.model_dump(mode="json"),
            "status": "READY_FOR_PLANNING",
            "events": [event.model_dump(mode="json") for event in events],
        }

    graph = StateGraph(LLMWorkflowState)
    for agent in analysis_agents:
        graph.add_node(agent.agent_id, specialist_node(agent))
    graph.add_node("supervisor_handoff", supervisor_node)
    for agent in analysis_agents:
        graph.add_edge(START, agent.agent_id)
    graph.add_edge([agent.agent_id for agent in analysis_agents], "supervisor_handoff")
    graph.add_edge("supervisor_handoff", END)
    return graph.compile()


def run_llm_agent_workflow(
    snapshot: FactorySnapshot,
    decision_case_id: str = "demo-agent-case",
    model=None,
) -> dict:
    started = time.monotonic()
    workflow = build_langgraph_agent_workflow(snapshot, model=model)
    result = workflow.invoke(
        {
            "decision_case_id": decision_case_id,
            "snapshot": snapshot,
            "reports": {},
            "narratives": {},
            "tool_calls": [],
            "events": [],
            "supervisor_summary": {},
            "status": "ANALYZING",
        }
    )
    ordered_events = sorted(result["events"], key=lambda event: event["occurred_at"])
    result["events"] = [
        {**event, "sequence": sequence}
        for sequence, event in enumerate(ordered_events, start=1)
    ]
    result["tool_calls"].sort(key=lambda call: call["tool_id"])
    result["metrics"] = AgentRunMetrics(
        duration_ms=max(0, round((time.monotonic() - started) * 1000)),
        tool_call_count=len(result["tool_calls"]),
        tool_failure_count=sum(
            call["status"] != ToolCallStatus.SUCCEEDED.value
            for call in result["tool_calls"]
        ),
        tool_failure_rate=(
            sum(
                call["status"] != ToolCallStatus.SUCCEEDED.value
                for call in result["tool_calls"]
            )
            / len(result["tool_calls"])
            if result["tool_calls"]
            else 0.0
        ),
        grounded_narrative_count=len(result["narratives"]) + 1,
        grounded_narrative_rate=1.0,
    ).model_dump(mode="json")
    return result


def run_specialist_analysis(
    snapshot: FactorySnapshot,
    decision_case_id: str = "demo-agent-case",
) -> AgentWorkflowResult:
    """Run evidence gathering; planning and operational commitment remain separate."""
    registry = AgentToolRegistry()
    now = snapshot.captured_at
    events: list[DecisionEvent] = []
    calls: list[ToolCallTrace] = []
    reports: dict[str, _Output] = {}
    for sequence, agent in enumerate(_SPECIALISTS[1:], start=1):
        run_id = f"run-{agent.agent_id}"
        events.append(
            DecisionEvent(
                event_id=f"event-agent-start-{sequence}",
                sequence=len(events) + 1,
                decision_case_id=decision_case_id,
                event_type=DecisionEventType.AGENT_STARTED,
                occurred_at=now + timedelta(seconds=len(events)),
                subject_id=run_id,
                correlation_id=decision_case_id,
                payload={"agent_id": agent.agent_id, "role": agent.role.value},
            )
        )
        tool_id = agent.allowed_tool_ids[0]
        tool_call_id = f"tool-call-{sequence}"
        tool_start = now + timedelta(seconds=len(events))
        events.append(
            DecisionEvent(
                event_id=f"event-tool-start-{sequence}",
                sequence=len(events) + 1,
                decision_case_id=decision_case_id,
                event_type=DecisionEventType.TOOL_STARTED,
                occurred_at=tool_start,
                subject_id=tool_call_id,
                correlation_id=decision_case_id,
                payload={"agent_run_id": run_id, "tool_id": tool_id},
            )
        )
        report = registry.invoke(agent, tool_id, snapshot)
        call = ToolCallTrace(
            tool_call_id=tool_call_id,
            decision_case_id=decision_case_id,
            agent_run_id=run_id,
            correlation_id=decision_case_id,
            tool_id=tool_id,
            tool_version=_TOOLS[tool_id].definition.version,
            status=ToolCallStatus.SUCCEEDED,
            started_at=tool_start,
            completed_at=tool_start + timedelta(seconds=1),
            input_summary={"snapshot_id": snapshot.snapshot_id},
            output_summary=report.model_dump(mode="json"),
            evidence_refs=list(getattr(report, "evidence_refs", [])),
        )
        reports[agent.agent_id] = report
        calls.append(call)
        events.append(
            DecisionEvent(
                event_id=f"event-tool-done-{sequence}",
                sequence=len(events) + 1,
                decision_case_id=decision_case_id,
                event_type=DecisionEventType.TOOL_COMPLETED,
                occurred_at=now + timedelta(seconds=len(events)),
                subject_id=tool_call_id,
                correlation_id=decision_case_id,
                payload={
                    "agent_run_id": run_id,
                    "tool_id": tool_id,
                    "tool_call_id": tool_call_id,
                    "status": call.status.value,
                    "evidence_refs": call.evidence_refs,
                },
            )
        )
        events.append(
            DecisionEvent(
                event_id=f"event-agent-done-{sequence}",
                sequence=len(events) + 1,
                decision_case_id=decision_case_id,
                event_type=DecisionEventType.AGENT_COMPLETED,
                occurred_at=now + timedelta(seconds=len(events)),
                subject_id=run_id,
                correlation_id=decision_case_id,
                payload={"agent_id": agent.agent_id, "tool_id": tool_id, "status": call.status.value},
            )
        )
    return AgentWorkflowResult(
        status="READY_FOR_PLANNING",
        reports=reports,
        tool_calls=tuple(calls),
        events=tuple(events),
        metrics=AgentRunMetrics(
            duration_ms=0,
            tool_call_count=len(calls),
            tool_failure_count=0,
            tool_failure_rate=0.0,
            grounded_narrative_count=0,
            grounded_narrative_rate=None,
        ),
    )
