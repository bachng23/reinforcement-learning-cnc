"""Classifier unit tests only; synthetic records are not policy/E2E evidence."""
import copy
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('scenario_evidence', Path(__file__).resolve().parents[2] / 'scripts/jcst_scenario_evidence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def session():
    return {'config': {'duration': [[[2, 8]], [[2, 8]]]}, 'primary': {'records': [{
        'tick': 5, 'before': {'components': [[{'failed': True}], [{'failed': False}]],
        'jobs': [None, {'machine': 1, 'component': 0, 'remaining': 2}]},
        'catalogue': [[], [[0, 0, 0]]], 'action': [[0, 0, 0]], 'events': []}]}}


def test_positive_long_duration_is_compatible_and_free_alternative_is_not_shortage():
    value = session()
    result = module.classify(value)
    assert not result['matches']['DEMO-03']
    assert result['resourceAlternatives'][0]['classification'] == 'FREE_ALTERNATIVE'
    assert result['resourceAlternatives'][0]['compatibleBusy'] == [1]


def test_no_free_compatible_technician_requires_wait_without_mutating_source():
    value = session()
    value['config']['duration'][0][0] = [0, 8]
    value['primary']['records'][0]['catalogue'] = [[]]
    before = copy.deepcopy(value)
    result = module.classify(value)
    assert result['matches']['DEMO-03'][0]['classification'] == 'WAIT_REQUIRED'
    assert value == before


def test_target_already_under_service_is_not_counted_as_waiting_for_dispatch():
    value = session()
    value['primary']['records'][0]['before']['jobs'][1]['machine'] = 0
    value['primary']['records'][0]['catalogue'] = [[]]
    result = module.classify(value)
    assert not result['matches']['DEMO-03']
    assert result['resourceAlternatives'][0]['classification'] == 'MACHINE_IN_SERVICE'


def test_near_failure_uses_event_times_and_distinct_machines():
    value = session()
    record = value['primary']['records'][0]
    record['events'] = [{'type': 'failure', 'tick': 3, 'machine': 0, 'component': 0},
                        {'type': 'failure', 'tick': 5, 'machine': 1, 'component': 0}]
    match = module.classify(value)['matches']['DEMO-02'][0]
    assert match['deltaTicks'] == 2 and not match['simultaneous']
    record['events'][0]['tick'] = 2
    assert not module.classify(value)['matches']['DEMO-02']
    record['events'][0].update(tick=5, machine=1)
    assert not module.classify(value)['matches']['DEMO-02']


def test_corrective_completion_and_later_failure_need_different_machines():
    value = session()
    record = value['primary']['records'][0]
    record['events'] = [{'type': 'failure', 'tick': 5, 'machine': 0, 'component': 0},
        {'type': 'start', 'tick': 5, 'machine': 0, 'component': 0, 'technician': 0, 'kind': 'CM', 'duration': 2},
        {'type': 'completion', 'tick': 7, 'machine': 0, 'component': 0, 'technician': 0, 'kind': 'CM'},
        {'type': 'failure', 'tick': 7, 'machine': 1, 'component': 0}]
    result = module.classify(value)
    assert len(result['matches']['DEMO-01']) == 1
    assert result['matches']['DEMO-04'][0]['deltaTicks'] == 0
    record['events'][-1]['machine'] = 0
    assert not module.classify(value)['matches']['DEMO-04']
