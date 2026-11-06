"""Independent golden expectations for reused engine components before M0 freeze.

These tests do NOT claim typed Scenario transforms, HTTP or product acceptance.
They change canonical test inputs directly to verify the proposed golden cases.
Expected values are hand-derived, never emitted by the scorer under test.
"""

import json
from fractions import Fraction
from pathlib import Path

import pytest

from domain.operations.contracts import ObjectiveWeights, PlanKPIs, PlanStrategy, RunDecisionCaseRequest
from domain.operations.scoring import ObjectiveScorer
from domain.operations.service import DecisionPlanningService, NoFeasiblePlan


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).parent / "fixtures/scenario-maintenance-90-minute-slot.json"


def request(duration=60, earliest="2026-10-27T00:00:00Z"):
    raw = json.loads(FIXTURE.read_text())
    maintenance = raw["factory_snapshot"]["maintenance_requests"][0]
    maintenance["expected_duration_minutes"] = duration
    maintenance["earliest_start_at"] = earliest
    return RunDecisionCaseRequest.model_validate(raw)


@pytest.mark.parametrize("duration", [30, 60, 90])
def test_physical_golden_fits_qualified_slot_and_preserves_source(duration):
    value = request(duration)
    source_before = value.model_dump_json()
    result = DecisionPlanningService().plan(value)
    plans = {p.strategy.value: p for p in result.candidate_plans}
    expected = {"PRODUCTION_PRIORITY", "RELIABILITY_PRIORITY"}
    if duration <= 60:
        expected.add("BALANCED")
    assert set(plans) == expected
    for name, plan in plans.items():
        assert plan.validation.verdict.value == "VALID"
        assert len(plan.schedule.assignments) == 1  # Mandatory request is never dropped.
        assignment = plan.schedule.assignments[0]
        assert assignment.maintenance_request_id == "MR1"
        assert assignment.technician_ids == ["T1"]
        start = (120 - duration) / 2 if name == "BALANCED" else 0
        assert (assignment.start_at - value.factory_snapshot.captured_at).total_seconds() / 60 == start
        assert (assignment.end_at - assignment.start_at).total_seconds() / 60 == duration
        assert plan.kpis.makespan_minutes == start + duration
    assert value.model_dump_json() == source_before


@pytest.mark.parametrize("duration", [91, 120])
def test_physical_golden_cannot_fit_90_minute_technician_slot(duration):
    with pytest.raises(NoFeasiblePlan, match="MR1"):
        DecisionPlanningService().plan(request(duration))


def test_defer_bound_cannot_be_ignored_to_fit_a_mandatory_request():
    # 31 + 60 = 91 > the technician's availability end at minute 90.
    with pytest.raises(NoFeasiblePlan, match="MR1"):
        DecisionPlanningService().plan(request(60, "2026-10-27T00:31:00Z"))


@pytest.mark.parametrize("restriction", ["skill", "availability"])
def test_physical_golden_does_not_relax_qualification_or_resource_constraints(restriction):
    raw = request().model_dump(mode="json")
    technician = raw["factory_snapshot"]["technicians"][0]
    if restriction == "skill":
        technician["skills"][0]["level"] = 3
    else:
        technician["availability"] = []
    with pytest.raises(NoFeasiblePlan, match="MR1"):
        DecisionPlanningService().plan(RunDecisionCaseRequest.model_validate(raw))


def ranked_reference_candidates():
    # Schedules provide valid canonical CandidatePlan containers. Synthetic KPI
    # vectors isolate scoring arithmetic; they are not planning integration proof.
    base = DecisionPlanningService().plan(request()).candidate_plans[0]
    golden = json.loads((ROOT / "docs/scenario-engine-golden-proposal.json").read_text())["ranking_case"]
    candidates = []
    for label in ["A", "B"]:
        item = golden["candidate_" + label]
        kpis = PlanKPIs(**item["kpis"], maximum_tardiness_minutes=item["kpis"]["total_tardiness_minutes"],
                       failure_probability=float(item["kpis"]["expected_failure_count"]))
        candidates.append(base.model_copy(update={"candidate_plan_id": "golden-" + label,
            "strategy": PlanStrategy(item["strategy"]), "kpis": kpis, "validation": None}))
    return candidates, golden


def test_weight_sweep_matches_independent_rational_rank_change_and_tie():
    candidates, golden = ranked_reference_candidates()
    before = [candidate.model_dump_json() for candidate in candidates]
    for point in golden["expected_points"]:
        weights = ObjectiveWeights(production=point["value"], **golden["fixed_raw_weights"])
        ranked = ObjectiveScorer().rank(candidates, weights)
        scores = {r.plan.candidate_plan_id: r.score for r in ranked}
        assert scores["golden-A"] == round(float(Fraction(point["score_A_fraction"])), 12)
        assert scores["golden-B"] == round(float(Fraction(point["score_B_fraction"])), 12)
        assert ranked[0].plan.strategy.value == point["selected"]
        assert (scores["golden-A"] == scores["golden-B"]) == point["tie"]
    assert [candidate.model_dump_json() for candidate in candidates] == before


def test_weight_sweep_honestly_has_no_rank_change_above_sampled_tie():
    candidates, golden = ranked_reference_candidates()
    for value in golden["no_change_values"]:
        ranked = ObjectiveScorer().rank(candidates, ObjectiveWeights(production=value, **golden["fixed_raw_weights"]))
        assert ranked[0].plan.strategy.value == golden["no_change_selected"]
