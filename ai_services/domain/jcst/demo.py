"""Engineering sessions over the unchanged pinned JCST engine.

Live operation uses receding-horizon policy features and bounded recent history.
The separate finite evaluation retains its original 48/16 protocol.

Incident mode has an explicit common WAIT prelude. It is not an SE1 evaluation.
No uniforms, physics, learned weights, or source findings are modified here.
"""
from dataclasses import asdict, replace
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path

from .contracts import Config, State
from .runtime import controller, infer, modules, raw_config, raw_state, source_manifest


def release_for(arm, case):
    registry = Path(os.environ.get('JCST_RELEASE_REGISTRY', ''))
    if not registry.is_file():
        raise ValueError('Registered learned checkpoints required for demo')
    # Fixed budget/root prevents comparing differently trained releases by accident.
    key = f'se1-{case}-{arm}-root0-96k'
    entry = dict(json.loads(registry.read_text())[key])
    entry['path'] = str(registry.parent / entry['path'])
    return key, entry


POLICIES = ('S', 'A', 'F', 'risk', 'corrective', 'threshold5', 'wait')
HISTORY_LIMIT = 256


def initialize(case='base', seed='990000001', mode='incident', primary='S', baseline='F', continuous=False):
    if case not in ('base', 'generalist') or mode not in ('incident', 'policy'):
        raise ValueError('Unsupported demo scenario')
    if len(seed) != 9 or not seed.startswith('99') or not seed.isdigit():
        raise ValueError('Use a dedicated engineering seed, 990000000..999999999')
    physics, _ = modules()
    cfg = physics.engineering_config()
    if case == 'generalist':
        cfg = replace(cfg, duration=tuple(((2, 8, 5), (8, 2, 5)) for _ in range(3)))
    releases = {}
    for arm in (primary, baseline):
        if arm not in POLICIES:
            raise ValueError('Unsupported maintenance policy')
        if arm not in ('S', 'A', 'F'):
            continue
        key, entry = release_for(arm, case)
        # Verify compatibility and checkpoint loading before publishing a session.
        infer(Config.model_validate(asdict(cfg)), State.model_validate(asdict(physics.initial_state(cfg))), entry, 48, 16)
        releases[arm] = {'release_id': key, 'sha256': entry['sha256']}
    def lane(arm):
        return dict(controller=arm, state=asdict(physics.initial_state(cfg)), records=[],
                    total_cost=0, controlled_cost=0, tail_cost=0, failures=0,
                    unavailable_machine_ticks=0, technician_busy_ticks=0, overrides=0)
    return dict(case_id=case, physical_seed=seed, mode=mode, horizon=48, tail=16,
                continuous=continuous, simulation_start=datetime.now(timezone.utc).isoformat(), step_seconds=900,
                config=asdict(cfg), source_commit=source_manifest()['commit'], releases=releases,
                primary=lane(primary), baseline=lane(baseline), status='RUNNING', activated=mode == 'policy',
                pending=None, decisions=[], workflow=[], first_incident_tick=None)


def note(session, stage, message):
    session['workflow'].append(dict(tick=session['primary']['state']['tick'], stage=stage, message=message))


def choose(session, lane):
    cfg = raw_config(Config.model_validate(session['config']))
    _, controls = modules()
    state = raw_state(cfg, State.model_validate(lane['state']))
    if not session.get('continuous') and state.tick >= session['horizon']:
        return list(controller('risk').choose(controls.observe(cfg, state, 48, 16)).action)
    if not session['activated']:
        return []
    if lane['controller'] not in ('S', 'A', 'F'):
        return list(controller(lane['controller']).choose(controls.observe(cfg, state, state.tick + 48 if session.get('continuous') else 48, 16)).action)
    key, release = release_for(lane['controller'], session['case_id'])
    if session['releases'][lane['controller']] != {'release_id': key, 'sha256': release['sha256']}:
        raise ValueError('Session checkpoint changed; create a new session')
    # Receding-horizon inference keeps the trained 48/16 feature scale, while
    # physical time, keyed failures, component ages and jobs continue unchanged.
    observation = {**lane['state'], 'tick': 0} if session.get('continuous') else lane['state']
    return infer(Config.model_validate(session['config']), State.model_validate(observation), release, 48, 16)['action']


def prepare(session):
    if session['status'] != 'RUNNING':
        raise ValueError('Session is not ready for a new decision')
    physics, _ = modules()
    cfg = raw_config(Config.model_validate(session['config']))
    state = raw_state(cfg, State.model_validate(session['primary']['state']))
    action = choose(session, session['primary'])
    baseline = choose(session, session['baseline'])
    catalogue = physics.legal_actions(cfg, state)
    if session['activated'] and (session.get('continuous') or state.tick < session['horizon']) and len(catalogue) > 1:
        note(session, 'OBSERVE', 'Read component condition and technician commitments from the simulator.')
        note(session, 'POLICY', f"{session['primary']['controller']} policy selected a complete maintenance matching.")
        note(session, 'VALIDATE', f'Action validated against {len(catalogue)} legal complete matchings; busy workers and machine conflicts excluded.')
        note(session, 'REVIEW', 'Matching ready for confirmation. Simulator state has not advanced at this boundary.')
        session['pending'] = dict(action=action, baseline_action=baseline, catalogue=catalogue, tick=state.tick)
        session['status'] = 'REVIEW'
    else:
        session['pending'] = dict(action=action, baseline_action=baseline, catalogue=catalogue, tick=state.tick)
        commit(session, action, 'automatic', 'Shared WAIT prelude' if not session['activated'] else 'Fixed risk tail' if not session.get('continuous') and state.tick >= 48 else 'Only WAIT is legal while technicians are occupied')
    return session


def commit(session, action, actor, reason):
    if session['pending'] is None or session['status'] == 'COMPLETE':
        raise ValueError('No pending decision')
    physics, _ = modules()
    cfg = raw_config(Config.model_validate(session['config']))
    # Demo-session v1 used JSON numbers for keyed uniforms. Some JSONB/client
    # transports round one ULP. Upgrade only those engineering values after
    # checking against the exact seed/tick/component key. New values are stored
    # as decimal strings; scientific artifact records are never rewritten.
    for lane_name in ('primary', 'baseline'):
        for record in session[lane_name]['records']:
            for event in record['events']:
                if event['type'] == 'failure' and not isinstance(event['uniform'], str):
                    exact = physics.keyed_uniform(int(session['physical_seed']), record['tick'], event['machine'], event['component'])
                    if abs(event['uniform'] - exact) > 2 * math.ulp(exact):
                        raise ValueError('Stored demo uniform differs from its physical key')
                    event['uniform'] = repr(exact)
    state = raw_state(cfg, State.model_validate(session['primary']['state']))
    chosen = physics.canonical_action(cfg, state, action)
    pending = session['pending']
    if pending['tick'] != state.tick:
        raise ValueError('Stale decision')
    override = [list(x) for x in chosen] != [list(x) for x in pending['action']]
    if override and actor == 'automatic':
        raise ValueError('Automatic mode cannot override policy')
    session['primary']['overrides'] += int(override)
    if session['status'] == 'REVIEW':
        session['decisions'].append(dict(tick=state.tick, actor=actor, reason=reason, action=chosen,
                                         proposed_action=pending['action'], override=override))
        note(session, 'DISPATCH', f"{'Automatic policy mode' if actor == 'automatic' else 'Human reviewer'} confirmed {len(chosen)} assignments" + (' (human override).' if override else '.'))
    for key, selected in (('primary', chosen), ('baseline', pending['baseline_action'])):
        lane = session[key]
        before = raw_state(cfg, State.model_validate(lane['state']))
        result = physics.transition(cfg, before, selected, int(session['physical_seed']))
        record = dict(tick=before.tick, phase='H' if session.get('continuous') or before.tick < 48 else 'tail', before=asdict(before),
                      action=selected, catalogue=physics.legal_actions(cfg, before), after=asdict(result.state),
                      cost=result.cost, breakdown=result.breakdown,
                      events=[{**e, 'uniform': repr(e['uniform'])} if e['type'] == 'failure' else e for e in result.events])
        lane['records'].append(record)
        if session.get('continuous'):
            del lane['records'][:-HISTORY_LIMIT]
        if 'completed_jobs' not in lane:
            lane['completed_jobs'] = [sum(e['type'] == 'completion' and e.get('technician') == j for r in lane['records'][:-1] for e in r['events']) for j in range(len(before.jobs))]
        completed = lane['completed_jobs']
        for event in result.events:
            if event['type'] == 'completion':
                completed[event['technician']] += 1
        lane['state'] = asdict(result.state)
        lane['total_cost'] += result.cost
        lane['controlled_cost' if session.get('continuous') or before.tick < 48 else 'tail_cost'] += result.cost
        lane['failures'] += sum(e['type'] == 'failure' for e in result.events)
        lane['technician_busy_ticks'] += sum(e['type'] == 'occupancy' for e in result.events)
        lane['unavailable_machine_ticks'] += result.breakdown['unavailable'] / cfg.unavailable_cost
    latest = session['primary']['records'][-1]
    failures = [e for e in latest['events'] if e['type'] == 'failure']
    if failures and session['first_incident_tick'] is None:
        session['first_incident_tick'] = session['primary']['state']['tick']
        note(session, 'INCIDENT', 'Simulator emitted component failure events. Policy coordination is now active.')
    if failures:
        session['activated'] = True
    for e in latest['events']:
        if e['type'] == 'completion':
            note(session, 'COMPLETE_SERVICE', f"T{e['technician']+1} completed {e['kind']} at M{e['machine']+1}/C{e['component']+1}.")
    session['pending'] = None
    session['status'] = 'COMPLETE' if not session.get('continuous') and session['primary']['state']['tick'] >= 64 else 'RUNNING'
    if session['status'] == 'COMPLETE':
        from .contracts import Episode
        from .runtime import audit_episode
        session['audits'] = {}
        for key in ('primary', 'baseline'):
            lane = session[key]
            episode = Episode(episode_id=f'demo-{key}', case_id=session['case_id'], controller=lane['controller'],
                              physical_seed=session['physical_seed'], seed_role='engineering', horizon=48, tail=16,
                              config=session['config'], records=lane['records'], controlled_cost=lane['controlled_cost'],
                              tail_cost=lane['tail_cost'], total_cost=lane['total_cost'])
            session['audits'][key] = audit_episode(episode)
        note(session, 'FINISHED', '48 controlled intervals and 16 fixed-risk tail intervals completed.')
    if session.get('continuous'):
        del session['workflow'][:-HISTORY_LIMIT]
        del session['decisions'][:-HISTORY_LIMIT]
    return session


def configure(session, primary, baseline, continuous=True):
    if primary not in POLICIES or baseline not in POLICIES or primary == baseline:
        raise ValueError('Choose two different maintenance policies')
    # Validate all releases before changing an existing operational session.
    releases = {}
    for arm in (primary, baseline):
        if arm in ('S', 'A', 'F'):
            key, entry = release_for(arm, session['case_id'])
            infer(Config.model_validate(session['config']), State.model_validate({**session['primary']['state'], 'tick': 0}), entry, 48, 16)
            releases[arm] = {'release_id': key, 'sha256': entry['sha256']}
    session['releases'].update(releases)
    changed = primary != session['primary']['controller'] or baseline != session['baseline']['controller']
    session['primary']['controller'] = primary
    session['baseline']['controller'] = baseline
    session['continuous'] = continuous
    session.setdefault('simulation_start', datetime.now(timezone.utc).isoformat())
    session.setdefault('step_seconds', 900)
    session['pending'] = None
    session['activated'] = True
    session['status'] = 'RUNNING'
    session.pop('audits', None)
    if changed:
        # Metrics before a policy switch cannot be attributed to the new policy.
        for lane in (session['primary'], session['baseline']):
            lane['comparison_start'] = dict(
                tick=lane['state']['tick'], failures=lane['failures'], total_cost=lane['total_cost'],
                downtime=lane['unavailable_machine_ticks'], controlled_cost=lane['controlled_cost'],
                technician_busy_ticks=lane['technician_busy_ticks'], overrides=lane['overrides'],
            )
    note(session, 'CONFIGURE', f'Maintenance policies: {primary} versus {baseline}. Continuous operation enabled.')
    return session


def autoplay(session, stop_at='complete', max_ticks=8):
    """Bounded automatic policy execution; pauses at truthful presentation events.

    Grouping transitions avoids starting Torch for every display frame. Every
    physical tick and policy decision is still computed and retained in order.
    """
    if stop_at not in ('incident', 'review', 'dispatch', 'repair', 'complete') or type(max_ticks) is not int or not 1 <= max_ticks <= 8:
        raise ValueError('Invalid autoplay bound')
    start = session['primary']['state']['tick']
    while session['status'] != 'COMPLETE' and session['primary']['state']['tick'] - start < max_ticks:
        previous_tick = session['primary']['state']['tick']
        previous_incident = session['first_incident_tick']
        if session['status'] == 'REVIEW':
            if stop_at == 'review':
                break
            commit(session, session['pending']['action'], 'automatic', 'Guided auto demo; policy matching confirmed automatically')
        else:
            prepare(session)
        if stop_at == 'review' and session['status'] == 'REVIEW':
            break
        if stop_at == 'incident' and previous_incident is None and session['first_incident_tick'] is not None:
            break
        if stop_at == 'dispatch' and session['primary']['state']['tick'] != previous_tick:
            if any(e['type'] == 'start' for e in session['primary']['records'][-1]['events']):
                break
        if stop_at == 'repair' and session['primary']['state']['tick'] != previous_tick:
            if any(e['type'] == 'completion' and e['kind'] == 'CM' for e in session['primary']['records'][-1]['events']):
                break
    return session
