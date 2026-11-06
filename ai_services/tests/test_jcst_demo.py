"""Real registered policies, engineering-only seeds and independent physics audits."""
import copy
import os
import json
import pytest
from domain.jcst.demo import initialize, prepare, commit

pytestmark = pytest.mark.skipif(not os.environ.get('JCST_RELEASE_REGISTRY'), reason='Explicit registered checkpoints required')


def test_incident_trigger_review_freeze_override_and_completion():
    session = initialize()
    for _ in range(5):
        prepare(session)
    assert session['first_incident_tick'] == 5
    assert json.dumps(session['primary']['records'], sort_keys=True) == json.dumps(session['baseline']['records'], sort_keys=True)
    before = copy.deepcopy(session['primary']['state'])
    prepare(session)
    assert session['status'] == 'REVIEW'
    assert session['primary']['state'] == before
    assert session['pending']['action'] != session['pending']['baseline_action']
    proposed = copy.deepcopy(session['pending']['action'])
    with pytest.raises(ValueError):
        commit(copy.deepcopy(session), [[0, 0, 0], [1, 0, 0]], 'human', 'invalid reuse')
    commit(session, proposed, 'human', 'Accept the policy')
    assert session['primary']['state']['tick'] == 6
    assert any(j and j['kind'] == 'CM' for j in session['primary']['state']['jobs'])
    while session['status'] != 'REVIEW':
        prepare(session)
    copy_for_override = copy.deepcopy(session)
    commit(copy_for_override, [], 'human', 'Inspect a legal WAIT alternative')
    assert copy_for_override['primary']['overrides'] == int(bool(copy_for_override['decisions'][-1]['proposed_action']))
    # Continue the accepted-policy trajectory; tail remains the fixed RiskMatching.
    while session['status'] != 'COMPLETE':
        if session['status'] == 'REVIEW':
            commit(session, session['pending']['action'], 'automatic', 'policy comparison')
        else:
            prepare(session)
    assert all(a['status'] == 'PASS' for a in session['audits'].values())
    for lane in (session['primary'], session['baseline']):
        assert len(lane['records']) == 64
        assert lane['total_cost'] == lane['controlled_cost'] + lane['tail_cost']
        assert all(isinstance(e['uniform'], str) for r in lane['records'] for e in r['events'] if e['type'] == 'failure')
        assert lane['unavailable_machine_ticks'] == sum(r['breakdown']['unavailable']/6 for r in lane['records'])
        assert any(e['type'] == 'completion' for r in lane['records'] for e in r['events'])
    with pytest.raises(ValueError):
        prepare(session)


@pytest.mark.parametrize('case', ['base', 'generalist'])
def test_policy_from_zero_preserves_same_inputs_and_independent_audit(case):
    session = initialize(case=case, mode='policy')
    assert session['primary']['state'] == session['baseline']['state']
    assert len(session['primary']['state']['jobs']) == (2 if case == 'base' else 3)
    while session['status'] != 'COMPLETE':
        prepare(session)
        if session['status'] == 'REVIEW':
            commit(session, session['pending']['action'], 'automatic', 'policy comparison')
    assert session['primary']['overrides'] == 0
    assert session['baseline']['overrides'] == 0
    assert all(a['status'] == 'PASS' for a in session['audits'].values())


def test_fixed_checkpoint_identity_cannot_change_mid_session():
    session = initialize(mode='policy')
    session['releases']['S']['sha256'] = '0' * 64
    with pytest.raises(ValueError, match='checkpoint changed'):
        prepare(session)


def test_engineering_seed_boundary_and_invalid_scenario():
    for seed in ('1','18034398509481984','9900000000'):
        with pytest.raises(ValueError):
            initialize(seed=seed)
    with pytest.raises(ValueError):
        initialize(case='unknown')


def test_demo_json_transport_preserves_uniform_and_rejects_material_corruption():
    import math
    session = initialize()
    for _ in range(5):
        prepare(session)
    # Emulate the one-ULP JSONB/client transport drift of the old demo format.
    event = next(e for r in session['primary']['records'] for e in r['events'] if e['type'] == 'failure')
    exact = event['uniform']
    event['uniform'] = math.nextafter(float(exact), 1.0)
    prepare(session)
    commit(session, session['pending']['action'], 'human', 'accept')
    assert event['uniform'] == exact
    bad = copy.deepcopy(session)
    bad_event = next(e for r in bad['primary']['records'] for e in r['events'] if e['type'] == 'failure')
    bad_event['uniform'] = 0.9
    with pytest.raises(ValueError, match='Stored demo uniform'):
        prepare(bad)


def test_autoplay_stops_at_real_events_and_matches_single_tick_execution():
    from domain.jcst.demo import autoplay
    session = initialize()
    baseline = copy.deepcopy(session)
    autoplay(session, 'incident', 8)
    assert session['primary']['state']['tick'] == 5
    assert session['status'] == 'RUNNING'
    autoplay(session, 'review', 8)
    assert session['status'] == 'REVIEW'
    assert session['primary']['state']['tick'] == 5
    autoplay(session, 'dispatch', 8)
    assert session['primary']['state']['tick'] == 6
    assert session['primary']['state']['jobs'][1]['kind'] == 'CM'
    assert session['decisions'][-1]['actor'] == 'automatic'
    autoplay(session, 'repair', 8)
    assert session['primary']['state']['tick'] == 7
    assert not session['primary']['state']['components'][2][1]['failed']
    while session['status'] != 'COMPLETE':
        before = session['primary']['state']['tick']
        autoplay(session, 'complete', 8)
        assert 1 <= session['primary']['state']['tick'] - before <= 8
    while baseline['status'] != 'COMPLETE':
        prepare(baseline)
        if baseline['status'] == 'REVIEW':
            commit(baseline, baseline['pending']['action'], 'automatic', 'policy comparison')
    for lane in ('primary', 'baseline'):
        assert json.dumps(session[lane], sort_keys=True) == json.dumps(baseline[lane], sort_keys=True)
        assert session['audits'][lane]['status'] == 'PASS'
    assert session['primary']['overrides'] == 0


def test_autoplay_bounds_and_review_pause_preserve_state():
    from domain.jcst.demo import autoplay
    session = initialize(mode='policy')
    for bound in (0, 9, True):
        with pytest.raises(ValueError):
            autoplay(copy.deepcopy(session), 'complete', bound)
    with pytest.raises(ValueError):
        autoplay(copy.deepcopy(session), 'fake-event', 1)
    autoplay(session, 'review', 1)
    frozen = copy.deepcopy(session)
    autoplay(session, 'review', 8)
    assert session == frozen


def test_continuous_operation_retains_state_past_episode_and_bounds_history():
    from domain.jcst.demo import autoplay, HISTORY_LIMIT
    session = initialize(mode='policy', primary='risk', baseline='corrective', continuous=True)
    for _ in range(40):
        autoplay(session, 'complete', 8)
    assert session['status'] == 'RUNNING'
    assert session['primary']['state']['tick'] == 320
    assert session['baseline']['state']['tick'] == 320
    assert session['primary']['records'][0]['tick'] == 320 - HISTORY_LIMIT
    assert len(session['primary']['records']) == HISTORY_LIMIT
    assert len(session['workflow']) <= HISTORY_LIMIT
    assert len(session['decisions']) <= HISTORY_LIMIT
    assert session['primary']['tail_cost'] == 0
    assert session['primary']['total_cost'] == session['primary']['controlled_cost']
    assert session['primary']['failures'] > 0
    assert sum(session['primary']['completed_jobs']) > 0
    assert 'audits' not in session


def test_policy_switch_keeps_physics_jobs_and_resets_comparison_origin():
    from domain.jcst.demo import configure
    session = initialize()
    for _ in range(5):
        prepare(session)
    prepare(session)
    commit(session, session['pending']['action'], 'human', 'Accept dispatch')
    states = copy.deepcopy([session['primary']['state'], session['baseline']['state']])
    configure(session, 'S', 'corrective')
    assert [session['primary']['state'], session['baseline']['state']] == states
    assert session['continuous'] is True
    assert session['pending'] is None
    assert session['primary']['comparison_start']['tick'] == 6
    assert session['baseline']['controller'] == 'corrective'
    before = copy.deepcopy(session)
    with pytest.raises(ValueError):
        configure(session, 'S', 'S')
    assert session == before


def test_continuous_learned_policy_stays_active_after_64_without_resetting_physical_time(monkeypatch):
    import domain.jcst.demo as demo
    session = initialize(mode='policy', continuous=True)
    calls = []
    original = demo.infer
    def capture(config, state, release, horizon, tail):
        calls.append((state.tick, release['arm'], horizon, tail))
        return original(config, state, release, horizon, tail)
    monkeypatch.setattr(demo, 'infer', capture)
    while session['primary']['state']['tick'] < 70:
        demo.autoplay(session, 'complete', 8 if session['primary']['state']['tick'] < 64 else 1)
    assert session['status'] == 'RUNNING'
    assert session['primary']['state']['tick'] == 70
    assert all(tick == 0 and (horizon, tail) == (48, 16) for tick, _, horizon, tail in calls)
    assert {arm for _, arm, _, _ in calls[-12:]} == {'S', 'F'}
    assert [record['tick'] for record in session['primary']['records']] == list(range(70))
    assert session['primary']['tail_cost'] == 0
