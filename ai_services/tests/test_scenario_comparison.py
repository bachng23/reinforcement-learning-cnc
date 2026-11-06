import pytest
from pydantic import ValidationError

from domain.scenarios.contracts import CompareRequest, EvaluationRequest
from domain.scenarios.comparison import compare_runs
from domain.scenarios.evaluation import ScenarioEvaluator
from domain.scenarios.hashing import content_hash
from test_scenario_transform import engine_payload, duration


def run(run_id, minutes):
    raw = engine_payload([duration(minutes)])
    raw['identity']['run_id'] = run_id
    source = EvaluationRequest.model_validate(raw)
    result = ScenarioEvaluator().evaluate(source)
    return {'input': source, 'result': result, 'result_hash': content_hash(result.model_dump(mode='json'))}


def test_comparison_computes_only_raw_delta_and_echoes_configs(monkeypatch):
    request = CompareRequest(runs=[run('one', 30), run('two', 60), run('three', 91)], budget={'remaining_ms': 1000})
    def forbidden(*args, **kwargs):
        pytest.fail('compare cannot replan')
    monkeypatch.setattr(ScenarioEvaluator, 'plan', forbidden)
    result = compare_runs(request)
    assert result.runs[0].comparison.score_comparison == 'NOT_COMPARABLE_ACROSS_REFERENCES'
    delta = next(m for m in result.runs[0].comparison.metrics if m.metric == 'makespan_minutes')
    assert delta.absolute_delta == 30
    assert delta.percent_delta == 100
    assert delta.change == 'WORSENED_UNDER_MODEL'
    missing = next(m for m in result.runs[1].comparison.metrics if m.metric == 'makespan_minutes')
    assert missing.scenario is None and missing.reason == 'SCENARIO_METRIC_MISSING'
    assert result.runs[0].planning_config == request.runs[1].input.planning_config


@pytest.mark.parametrize('case', ['duplicate', 'workspace', 'factory', 'result_hash'])
def test_comparison_rejects_mixed_or_tampered_saved_runs(case):
    left, right = run('one', 30), run('two', 60)
    if case == 'result_hash':
        right['result_hash'] = '0' * 64
    else:
        key, value = {'duplicate': ('run_id', 'one'), 'workspace': ('workspace_id', 'another'), 'factory': ('factory_id', 'another')}[case]
        identity = right['input'].identity.model_copy(update={key: value})
        right['input'] = right['input'].model_copy(update={'identity': identity})
    with pytest.raises(ValidationError):
        CompareRequest(runs=[left, right], budget={'remaining_ms': 1000})


def test_cannot_relabel_saved_result_with_new_objectives():
    left, right = run('one', 30), run('two', 60)
    config = right['input'].planning_config
    weights = config.objective_weights.model_copy(update={'production': 999})
    right['input'] = right['input'].model_copy(update={'planning_config': config.model_copy(update={'objective_weights': weights})})
    request = CompareRequest(runs=[left, right], budget={'remaining_ms': 1000})
    with pytest.raises(ValueError, match='semantic'):
        compare_runs(request)
