"""Real engineering physics and policies; no bridge double or fixture fallback."""
from copy import deepcopy
import json
from uuid import uuid4

import pytest
from domain.jcst import availability as a, demo, situations as s

ACTOR = {'type': 'USER', 'userId': '00000000-0000-4000-8000-000000000001'}


def session(primary='corrective', baseline='wait'):
    p = demo.initialize('base', '990000001', 'policy', primary, baseline, True)
    return json.loads(json.dumps(p))


def plan(p, index=0, duration=3, early=False):
    m = deepcopy(a.metadata(p)); tick = p['primary']['state']['tick']; eid = str(uuid4())
    if early:
        current = next(x for x in m['absences'] if x['technicianIndex'] == index and x['endedTick'] is None)
        current.update(endedTick=tick, endedByEventId=eid)
    else:
        m['absences'].append(dict(eventId=eid, automaticEndEventId=str(uuid4()), technicianIndex=index,
                                 startTick=tick, returnTick=tick+duration, endedTick=None, endedByEventId=None))
    m['version'] += 1
    m['origin'] = dict(eventId=eid, tick=tick, workforceVersion=m['version'])
    m['events'].append(dict(eventId=eid, technicianIndex=index, type='ABSENCE_RETURNED_EARLY' if early else 'ABSENCE_STARTED',
                           tick=tick, actor=ACTOR, reason='Engineering test'))
    return m


def step(p):
    return s.command(p, {'command': 'advance', 'autoApprove': True}, ACTOR['userId'])


@pytest.mark.parametrize('policy', ['corrective', 'wait', 'risk', 'threshold5'])
def test_empty_metadata_keeps_exact_legacy_output(policy):
    original = session(policy); explicit = deepcopy(original)
    explicit['technicianAvailability'] = a.empty()
    for _ in range(7):
        original, explicit = step(original), step(explicit)
        assert original['primary'] == explicit['primary']
        assert original['baseline'] == explicit['baseline']


def test_interval_and_autoplay_boundary_and_busy_counter():
    p = session(); p = a.change(p, plan(p))
    assert p['primary']['state']['tick'] == 0
    assert a.summary(p)[0]['availability'] == 'ABSENT'
    b = deepcopy(p)
    for _ in range(3): p = step(p)
    b = s.command(b, {'command': 'autoplay', 'stopAt': 'complete', 'maxTicks': 3}, 'automatic')
    assert p['primary'] == b['primary'] and p['baseline'] == b['baseline']
    assert p['technicianAvailability'] == b['technicianAvailability']
    assert a.summary(p)[0]['availability'] == 'AVAILABLE'
    assert p['technicianAvailability']['events'][-1]['tick'] == 3
    assert p['technicianAvailability']['version'] == 1
    assert p['primary']['technician_busy_ticks'] == 0
    assert len(step(p)['technicianAvailability']['events']) == 2


def failed(p, machine=0, component=0):
    p = deepcopy(p); p['primary']['state']['components'][machine][component]['failed'] = True
    return p


def test_all_absent_wait_and_only_available_worker_catalogue():
    p = failed(session(), 0, 1)  # T2 is the fast specialist for C2.
    p = a.change(p, plan(p)); demo.prepare(p)
    assert p['status'] == 'REVIEW'
    assert p['pending']['action'] and all(e[2] == 1 for e in p['pending']['action'])
    assert all(all(e[2] == 1 for e in matching) for matching in p['pending']['catalogue'])
    with pytest.raises(s.SituationError): demo.commit(deepcopy(p), [[0, 1, 0]], 'human', 'Illegal absent worker')
    p = a.change(p, plan(p, 1)); demo.prepare(p)
    assert p['primary']['records'][-1]['action'] == [] or p['primary']['records'][-1]['action'] == ()
    assert not any(e['type'] == 'start' for e in p['primary']['records'][-1]['events'])
    assert a.repair_warnings(p)[0]['technicians'] == [dict(technicianIndex=i, reason='ABSENT') for i in (0, 1)]


def test_early_return_at_review_discards_proposal_and_deferral():
    p = a.change(failed(session(), 0, 1), plan(session()))
    demo.prepare(p); assert p['status'] == 'REVIEW'
    p['review_deferral'] = {'old': True}
    returned = a.change(p, plan(p, early=True))
    assert returned['pending'] is None and returned['status'] == 'RUNNING'
    assert returned['review_deferral'] is None and returned['playbackPaused']
    assert returned['primary'] == p['primary'] and returned['baseline'] == p['baseline']
    demo.prepare(returned)
    assert any(any(e[2] == 0 for e in action) for action in returned['pending']['catalogue'])


def test_primary_busy_rejected_baseline_busy_finishes_and_expiry_completion_same_tick():
    p = session()
    job = dict(machine=0, component=0, technician=0, kind='PM', remaining=1)
    p['primary']['state']['jobs'][0] = job
    with pytest.raises(s.SituationError, match='TECHNICIAN_BUSY'): a.change(p, plan(p, duration=1))
    p['primary']['state']['jobs'][0] = None
    p['baseline']['state']['jobs'][0] = job
    p = a.change(p, plan(p, duration=1)); p = step(p)
    assert p['baseline']['state']['jobs'][0] is None
    assert a.summary(p)[0]['availability'] == 'AVAILABLE'
    assert p['baseline']['technician_busy_ticks'] == 1
    assert p['primary']['technician_busy_ticks'] == 0
    assert s.audit_retained(p)['status'] == 'PASS'


def test_save_restore_exact_calendar_and_replay_expiry_once():
    p = a.change(session(), plan(session(), duration=1)); frozen = s.snapshot(p)
    first, second = s.restore(frozen), s.restore(frozen)
    for _ in range(4):
        first, second = step(first), step(second)
        assert first == second
    assert len(first['technicianAvailability']['events']) == 2
    assert frozen['runtime']['technicianAvailability']['absences'][0]['endedTick'] is None


@pytest.mark.parametrize('index,duration', [(2,3), (-1,3), (True,3), (0,0), (0,-1), (0,100001)])
def test_invalid_index_duration(index, duration):
    p = session()
    with pytest.raises(s.SituationError): a.change(p, plan(p, index, duration))


def test_overlap_rejected_and_protocol_bounded():
    p = a.change(session(), plan(session()))
    with pytest.raises(s.SituationError): a.change(p, plan(p))
    result = a.execute(dict(protocol=a.PROTOCOL, operation='demo_technician_change', session=p, metadata={'bad': True}))
    assert result == dict(protocol=a.PROTOCOL, error=dict(code='DEMO_SNAPSHOT_INCOMPATIBLE'))


def test_common_snapshot_comparison_shares_state_calendar_and_cache_identity():
    p = a.change(session(), plan(session(), duration=1)); frozen = s.snapshot(p)
    before = deepcopy(frozen)
    compared = a.compare_from_snapshot(frozen, ['corrective', 'risk', 'threshold5'], 2)
    assert compared == a.compare_from_snapshot(frozen, ['corrective', 'risk', 'threshold5'], 2)
    assert frozen == before
    for branch in compared['branches']:
        records = branch['lane']['records']
        assert records[0]['before'] == compared['commonInitialState']
        assert all(edge[2] != 0 for edge in records[0]['action'])
        assert branch['calendar']['events'][-1]['type'] == 'ABSENCE_ENDED'
        assert branch['calendar']['events'][-1]['tick'] == 1
        assert branch['audit']['status'] == 'PASS'
    returned = a.change(p, plan(p, early=True))
    assert compared['cacheIdentity'] != a.compare_from_snapshot(s.snapshot(returned), ['corrective', 'risk', 'threshold5'], 2)['cacheIdentity']
