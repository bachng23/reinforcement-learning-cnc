from datetime import timedelta
import pytest
from pydantic import ValidationError

from domain.operations.contracts import RunDecisionCaseRequest
from domain.operations.service import DecisionPlanningService, NoFeasiblePlan
from domain.scenarios.contracts import EvaluationRequest
from domain.scenarios.evaluation import ScenarioEvaluator
from test_scenario_transform import engine_payload
from test_scenario_engine_baseline_golden import request


def live_request(minute):
    original = request()
    trigger = {'type': 'MANUAL_REPLAN', 'event_id': 'live-defer', 'occurred_at': original.factory_snapshot.captured_at,
        'requested_by_user_id': 'engineer', 'reason': 'Apply reviewed maintenance lower bound',
        'maintenance_start_constraints': [{'maintenance_request_id': 'MR1',
            'earliest_start_at': original.factory_snapshot.captured_at + timedelta(minutes=minute)}]}
    return RunDecisionCaseRequest.model_validate({**original.model_dump(), 'mode': 'LIVE', 'trigger': trigger})


def test_typed_defer_maps_to_real_live_schedule_without_mutating_source():
    source = live_request(30)
    before = source.model_dump_json()
    result = DecisionPlanningService().plan(source)
    for candidate in result.candidate_plans:
        assert candidate.validation.verdict.value == 'VALID'
        assert candidate.schedule.assignments[0].start_at >= source.factory_snapshot.captured_at + timedelta(minutes=30)
    assert source.model_dump_json() == before
    payload = engine_payload([{'type': 'DEFER_MAINTENANCE', 'maintenance_request_id': 'MR1', 'earliest_start_at': '2026-10-27T00:30:00Z'}])
    scenario = ScenarioEvaluator().evaluate(EvaluationRequest.model_validate(payload))
    assert scenario.live_mapping.supported
    assert len(scenario.live_mapping.mapped_defer_bounds) == 1


def test_live_defer_must_not_ignore_hard_availability_to_force_feasibility():
    with pytest.raises(NoFeasiblePlan):
        DecisionPlanningService().plan(live_request(31))


def test_unknown_targets_rejected_and_no_extension_preserves_wire_shape():
    raw = live_request(0).model_dump(mode='json')
    raw['trigger']['maintenance_start_constraints'][0]['maintenance_request_id'] = 'unknown'
    with pytest.raises(ValidationError):
        RunDecisionCaseRequest.model_validate(raw)
    raw['trigger'].pop('maintenance_start_constraints')
    parsed = RunDecisionCaseRequest.model_validate(raw)
    assert 'maintenance_start_constraints' not in parsed.model_dump(mode='json')['trigger']
