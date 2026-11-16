"""Real built-in policies and physical transitions; no checkpoint/test-double dependency."""
from copy import deepcopy
import json
from uuid import uuid4

import pytest
from domain.jcst import demo, situations as s


def session():
    result = demo.initialize('base', '990000001', 'policy', 'corrective', 'wait', True)
    result['simulation_start'] = '2026-11-16T00:00:00Z'
    result['branch'] = {'branchId': str(uuid4())}
    return json.loads(json.dumps(result))


def event(tick=0, machine=2, component=1):
    return dict(eventId=str(uuid4()), machineIndex=machine, componentIndex=component,
                scheduledTick=tick, status='SCHEDULED', appliedTick=None, reason=None,
                requestedReason='Acceptance exercise', createdBy='00000000-0000-4000-8000-000000000001',
                createdAt='2026-11-16T00:00:00Z')


def step(p):
    return s.command(p, {'command': 'advance', 'autoApprove': True}, 'automatic')


def test_restore_healthy_exact_trajectory_and_immutability():
    original = session()
    frozen = s.snapshot(original, {'layoutId': 'smt-board-assembly'})
    saved = deepcopy(frozen)
    a, b = s.restore(frozen), s.restore(frozen)
    for _ in range(10):
        a, b = step(a), step(b)
        assert a == b  # Includes every cost/event and exact decimal uniform string.
    assert frozen == saved
    assert original['primary']['state']['tick'] == 0


def test_immediate_before_observation_preserves_time_age_jobs_and_baseline():
    original = session()
    p, e = s.inject(original, event())
    assert e['status'] == 'APPLIED' and e['appliedTick'] == 0
    assert p['primary']['state']['tick'] == 0
    assert p['primary']['state']['components'][2][1] == {'age': 0, 'failed': True}
    assert p['baseline'] == original['baseline'] and p['primary']['records'] == []
    assert not original['primary']['state']['components'][2][1]['failed']
    assert s.failure_counters(p) == {'physics': 0, 'injected': 1, 'total': 1}
    assert s.engineering_events(p)[0]['source'] == 'INJECTED'
    demo.prepare(p)
    assert [2, 1, 1] in [list(x) for x in p['pending']['action']]
    p = s.command(p, {'command': 'approve', 'reason': 'Repair'}, 'operator')
    assert p['primary']['state']['jobs'][1]['kind'] == 'CM'
    assert p['primary']['state']['jobs'][1]['remaining'] == 1
    p = step(p)
    assert any(e['type'] == 'completion' and e['machine'] == 2 and e['tick'] == 2
               for e in p['primary']['records'][-1]['events'])


def test_scheduled_single_step_equals_autoplay_and_applies_before_response():
    p, _ = s.inject(session(), event(2))
    one = step(step(p))
    multi = s.command(p, {'command': 'autoplay', 'stopAt': 'complete', 'maxTicks': 2}, 'automatic')
    assert one['primary'] == multi['primary']
    assert one['baseline'] == multi['baseline']
    assert one['incidents'] == multi['incidents']
    assert multi['incidents'][0]['status'] == 'APPLIED'
    assert multi['primary']['state']['tick'] == 2
    assert multi['primary']['state']['components'][2][1]['failed']
    assert all(e.get('uniform') is None for e in s.engineering_events(multi))


def test_natural_failure_before_schedule_skips_and_keeps_uniform():
    p, _ = s.inject(session(), event(5))
    # WAIT until the known natural failure at t5 (same boundary processed physics first).
    for _ in range(5):
        demo.prepare(p)
        if p['status'] == 'REVIEW':
            demo.commit(p, [], 'operator', 'Wait for natural failure')
    assert p['incidents'][0]['status'] == 'SKIPPED'
    assert p['incidents'][0]['reason'] == 'COMPONENT_ALREADY_FAILED'
    natural = [e for r in p['primary']['records'] for e in r['events'] if e['type'] == 'failure']
    assert natural and isinstance(natural[0]['uniform'], str)
    assert s.failure_counters(p)['injected'] == 0


def test_repair_snapshot_and_completion_boundary_allows_next_incident():
    p, _ = s.inject(session(), event())
    p = step(p)
    assert p['primary']['state']['jobs'][1]['remaining'] == 1
    frozen = s.snapshot(p)
    a, b = s.restore(frozen), s.restore(frozen)
    assert a == b == p
    a, _ = s.inject(a, event(2))
    a = step(a)
    assert a['incidents'][-1]['status'] == 'APPLIED'
    assert a['primary']['state']['jobs'][1] is None
    assert a['primary']['state']['components'][2][1]['failed']
    assert step(b)['primary']['state']['components'][2][1]['failed'] is False


def test_busy_machine_skipped_without_touching_job_or_workflow():
    p, _ = s.inject(session(), event())
    p = step(p)
    next_p, e = s.inject(p, event(1, component=0))
    assert e['reason'] == 'MACHINE_IN_SERVICE' and e['status'] == 'SKIPPED'
    assert next_p['primary'] == p['primary']
    assert next_p['workflow'] == p['workflow']


def test_review_restore_conflict_and_future_queue():
    p = session()
    demo.prepare(p)
    restored = s.restore(s.snapshot(p))
    assert restored == p and restored['status'] == 'REVIEW'
    with pytest.raises(s.SituationError, match='DEMO_REVIEW_REQUIRED'):
        s.inject(restored, event())
    queued, _ = s.inject(restored, event(1))
    advanced = s.command(queued, {'command': 'approve', 'reason': 'Resolve review'}, 'operator')
    assert advanced['incidents'][0]['status'] == 'APPLIED'
    # Legacy/corrupt prepared observation: fail before executing matching.
    malformed = deepcopy(p)
    malformed['incidents'] = [event()]
    with pytest.raises(s.SituationError, match='DEMO_REVIEW_REQUIRED'):
        s.command(malformed, {'command': 'approve', 'reason': 'Stale observation'}, 'operator')
    assert malformed['primary']['state']['tick'] == 0


def test_duplicate_identity_replay_and_duplicate_target_rejection():
    original, e = session(), event()
    a, _ = s.inject(original, e)
    b, replayed = s.inject(a, e)
    assert a == b and replayed['status'] == 'APPLIED'
    with pytest.raises(s.SituationError):
        s.inject(a, event())
    a = s.restore(s.snapshot(a))
    a = step(step(a))
    assert len(a['incidents']) == 1 and s.failure_counters(a)['injected'] == 1


@pytest.mark.parametrize('m,c', [(-1, 0), (3, 0), (0, 2), (True, 0)])
def test_invalid_index(m, c):
    with pytest.raises(s.SituationError):
        s.inject(session(), event(machine=m, component=c))


def test_invalid_snapshot_version_source_state_and_missing_release():
    frozen = s.snapshot(session())
    for field, value in [('schemaVersion', 'future')]:
        bad = deepcopy(frozen); bad[field] = value
        with pytest.raises(s.SituationError): s.restore(bad)
    for field, value in [('source_commit', 'unknown'), ('step_seconds', 0)]:
        bad = deepcopy(frozen); bad['runtime'][field] = value
        with pytest.raises(s.SituationError): s.restore(bad)
    bad = deepcopy(frozen); bad['runtime']['primary']['state']['jobs'][0] = dict(machine=2, component=1, technician=0, kind='CM', remaining=1)
    with pytest.raises(s.SituationError): s.restore(bad)
    bad = deepcopy(frozen); bad['runtime']['primary']['controller'] = 'S'
    with pytest.raises(s.SituationError, match='DEMO_RELEASE_UNAVAILABLE'): s.restore(bad)


def test_protocol_errors_bounded_and_snapshot_json_roundtrip():
    frozen = s.snapshot(session())
    assert s.execute(dict(protocol=s.PROTOCOL, operation='demo_snapshot_restore', snapshot=json.loads(json.dumps(frozen))))['session'] == frozen['runtime']
    frozen['schemaVersion'] = 'future'
    assert s.execute(dict(protocol=s.PROTOCOL, operation='demo_snapshot_restore', snapshot=frozen)) == {
        'protocol': s.PROTOCOL, 'error': {'code': 'DEMO_SNAPSHOT_INCOMPATIBLE'}}


def test_same_machine_two_targets_and_order_deterministic():
    p, _ = s.inject(session(), event(2, component=0))
    p, _ = s.inject(p, event(2, component=1))
    p = step(step(p))
    assert [e['status'] for e in p['incidents']] == ['APPLIED', 'SKIPPED']


def test_finite_scientific_audit_not_claimed_for_interventions():
    p, _ = s.inject(session(), event())
    # Keep continuous trajectory until final boundary, then test explicit guard.
    for _ in range(63):
        demo.prepare(p)
        if p['status'] == 'REVIEW':
            demo.commit(p, p['pending']['action'], 'automatic', 'Finite boundary test')
    p['continuous'] = False
    with pytest.raises(s.SituationError, match='DEMO_INTERVENTION_REPLAY_UNSUPPORTED'):
        step(p)


def test_independent_physics_audit_reconciles_injected_boundaries_and_rejects_corruption():
    p, _ = s.inject(session(), event(2))
    for _ in range(8): p = step(p)
    assert s.audit_retained(p)['intervals'] == 16
    assert s.restore(s.snapshot(p)) == p
    bad = deepcopy(p)
    bad['primary']['records'][-1]['cost'] += 1
    with pytest.raises(s.SituationError): s.audit_retained(bad)
    bad = deepcopy(p)
    bad['primary']['state']['components'][0][0]['age'] += 1
    with pytest.raises(s.SituationError): s.restore(s.snapshot(bad))


def test_restore_keeps_state_and_counters_after_trace_eviction():
    p = session()
    for _ in range(33): demo.autoplay(p, 'complete', 8)
    assert p['primary']['state']['tick'] == 264
    assert len(p['primary']['records']) == 256
    frozen = s.snapshot(p)
    a, b = s.restore(frozen), s.restore(frozen)
    assert a == b == p
    assert step(a) == step(b)
