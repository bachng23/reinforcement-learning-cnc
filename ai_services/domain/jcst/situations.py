"""Engineering snapshot/incident protocol. The pinned physical engine is unchanged."""
from copy import deepcopy
from datetime import datetime
import importlib
import json
import math
from uuid import UUID

from .contracts import Config, Record, State
from .runtime import modules, raw_config, raw_state, source_manifest

PROTOCOL = 'jcst-situations/1'
VERSION = 'jcst-demo-snapshot/1'


class SituationError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def invalid():
    raise SituationError('DEMO_SNAPSHOT_INCOMPATIBLE')


def uint(value):
    return type(value) is int and 0 <= value <= 2147483647


def validate_event(e, session):
    fields = {'eventId', 'machineIndex', 'componentIndex', 'scheduledTick', 'status',
              'appliedTick', 'reason', 'requestedReason', 'createdBy', 'createdAt'}
    if not isinstance(e, dict) or set(e) != fields:
        invalid()
    try:
        UUID(e['eventId']); UUID(e['createdBy'])
        datetime.fromisoformat(e['createdAt'].replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        invalid()
    m, c, t = e['machineIndex'], e['componentIndex'], e['scheduledTick']
    if not all(uint(v) for v in (m, c, t)) or m >= len(session['config']['components']) or c >= len(session['config']['components'][m]):
        invalid()
    if not isinstance(e['requestedReason'], str) or not 1 <= len(e['requestedReason'].strip()) <= 1000:
        invalid()
    now = session['primary']['state']['tick']
    if e['status'] == 'SCHEDULED':
        if t < now or e['appliedTick'] is not None or e['reason'] is not None:
            invalid()
    elif e['status'] in ('APPLIED', 'SKIPPED'):
        if not uint(e['appliedTick']) or e['appliedTick'] != t or t > now:
            invalid()
        if e['status'] == 'APPLIED' and e['reason'] is not None:
            invalid()
        if e['status'] == 'SKIPPED' and e['reason'] not in ('MACHINE_IN_SERVICE', 'COMPONENT_ALREADY_FAILED'):
            invalid()
    else:
        invalid()


def validate_session(session, check_releases=True):
    """Validate in place without normalizing, dropping fields or resetting counters."""
    from .demo import POLICIES, release_for
    from .runtime import infer
    try:
        # JSON safety (including unsupported objects/NaNs) without changing representation.
        json.dumps(session, allow_nan=False)
        if session['source_commit'] != source_manifest()['commit']:
            invalid()
        config = Config.model_validate(session['config'])
        cfg = raw_config(config)
        physics, _ = modules()
        def checked_state(value):
            state = physics.state_from_json(cfg, State.model_validate(value).model_dump_json())
            physics.validate_state(cfg, state)
            return state
        if session['case_id'] not in ('base', 'generalist') or session['mode'] not in ('policy', 'incident'):
            invalid()
        seed = session['physical_seed']
        if not isinstance(seed, str) or len(seed) != 9 or not seed.startswith('99') or not seed.isdigit():
            invalid()
        if type(session['continuous']) is not bool or type(session['activated']) is not bool:
            invalid()
        if session['horizon'] != 48 or session['tail'] != 16:
            invalid()
        if not isinstance(session['step_seconds'], (int, float)) or isinstance(session['step_seconds'], bool) or session['step_seconds'] <= 0:
            invalid()
        datetime.fromisoformat(session['simulation_start'].replace('Z', '+00:00'))
        if session['status'] not in ('RUNNING', 'REVIEW', 'COMPLETE'):
            invalid()
        for name in ('primary', 'baseline'):
            lane = session[name]
            if lane['controller'] not in POLICIES:
                invalid()
            state = checked_state(lane['state'])
            if not uint(state.tick) or not isinstance(lane['records'], list) or len(lane['records']) > 256:
                invalid()
            previous = -1
            for r in lane['records']:
                Record.model_validate(r)
                checked_state(r['before'])
                checked_state(r['after'])
                if r['tick'] <= previous or r['after']['tick'] > state.tick:
                    invalid()
                previous = r['tick']
            for key in ('total_cost', 'controlled_cost', 'tail_cost', 'failures',
                        'unavailable_machine_ticks', 'technician_busy_ticks', 'overrides'):
                v = lane[key]
                if type(v) not in (int, float) or not math.isfinite(v) or v < 0:
                    invalid()
            if not math.isclose(lane['total_cost'], lane['controlled_cost'] + lane['tail_cost'], abs_tol=1e-8):
                invalid()
        if session['primary']['state']['tick'] != session['baseline']['state']['tick']:
            invalid()
        pending = session['pending']
        if session['status'] == 'REVIEW':
            if not pending or pending['tick'] != session['primary']['state']['tick']:
                invalid()
            primary = raw_state(cfg, State.model_validate(session['primary']['state']))
            baseline = raw_state(cfg, State.model_validate(session['baseline']['state']))
            physics.canonical_action(cfg, primary, pending['action'])
            physics.canonical_action(cfg, baseline, pending['baseline_action'])
            expected = {tuple(tuple(edge) for edge in a) for a in physics.legal_actions(cfg, primary)}
            observed = [tuple(tuple(edge) for edge in a) for a in pending['catalogue']]
            if len(set(observed)) != len(observed) or set(observed) != expected:
                invalid()
        elif pending is not None:
            invalid()
        incidents = session.get('incidents', [])
        if not isinstance(incidents, list) or len(incidents) > 1024:
            invalid()
        ids, points = set(), set()
        for event in incidents:
            validate_event(event, session)
            point = (event['machineIndex'], event['componentIndex'], event['scheduledTick'])
            if event['eventId'] in ids or point in points:
                invalid()
            ids.add(event['eventId']); points.add(point)
        releases = session['releases']
        active = {session[n]['controller'] for n in ('primary', 'baseline')} & {'S', 'A', 'F'}
        if not isinstance(releases, dict):
            invalid()
        if check_releases:
            try:
                for arm in active | set(releases):
                    if arm not in ('S', 'A', 'F'):
                        invalid()
                    key, release = release_for(arm, session['case_id'])
                    if releases.get(arm) != {'release_id': key, 'sha256': release['sha256']}:
                        raise ValueError('release identity changed')
                    # Load every pinned checkpoint and validate config compatibility, no action execution.
                    state = session['primary']['state']
                    infer(config, State.model_validate({**state, 'tick': 0} if session['continuous'] else state), release, 48, 16)
            except (OSError, ValueError, KeyError, RuntimeError, ImportError):
                raise SituationError('DEMO_RELEASE_UNAVAILABLE') from None
        return session
    except SituationError:
        raise
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, OverflowError):
        invalid()


def snapshot(session, context=None, work_orders=None, provenance=None):
    validate_session(session)
    return deepcopy({'schemaVersion': VERSION, 'runtime': session,
                     'context': context or {}, 'workOrders': work_orders,
                     'provenance': provenance or {}})


def restore(frozen):
    if not isinstance(frozen, dict) or frozen.get('schemaVersion') != VERSION or set(frozen) != {'schemaVersion', 'runtime', 'context', 'workOrders', 'provenance'}:
        invalid()
    session = deepcopy(frozen['runtime'])
    validate_session(session)
    source_tick = frozen['provenance'].get('sourceTick')
    if source_tick is not None and source_tick != session['primary']['state']['tick']:
        invalid()
    audit_retained(session)
    return session


def audit_retained(session):
    """Independent interval physics, with explicit engineering boundary reconciliation.

    Does not assert pre-retention history or scientific counterfactual fairness.
    """
    modules()
    auditor = importlib.import_module('jcst_replay_audit')
    cfg, seed = session['config'], int(session['physical_seed'])
    count, gaps = 0, []
    def json_value(value):
        return json.loads(json.dumps(value))
    def boundary(state, name):
        value = json_value(state)
        if name == 'primary':
            for event in session.get('incidents', []):
                if event['status'] == 'SCHEDULED' or event['appliedTick'] != value['tick']:
                    continue
                machine = event['machineIndex']
                busy = any(j and j['machine'] == machine for j in value['jobs'])
                failed = any(c['failed'] for c in value['components'][machine])
                reason = 'MACHINE_IN_SERVICE' if busy else 'COMPONENT_ALREADY_FAILED' if failed else None
                if event['reason'] != reason or event['status'] != ('SKIPPED' if reason else 'APPLIED'):
                    invalid()
                if not reason:
                    value['components'][machine][event['componentIndex']]['failed'] = True
        return value
    for name in ('primary', 'baseline'):
        previous = None
        for record in session[name]['records']:
            if previous is not None:
                if previous['tick'] == record['tick']:
                    if boundary(previous, name) != json_value(record['before']): invalid()
                else: gaps.append({'lane': name, 'fromTick': previous['tick'], 'toTick': record['tick']})
            action = tuple(tuple(edge) for edge in record['action'])
            if action not in auditor.catalogue(cfg, record['before']): invalid()
            after, breakdown, signatures = auditor.independent_step(cfg, record['before'], action, seed)
            if after != json_value(record['after']) or breakdown != record['breakdown'] or not math.isclose(sum(breakdown.values()), record['cost'], abs_tol=1e-8): invalid()
            actual = []
            for kind, fields in [('start', ('tick', 'machine', 'component', 'technician', 'kind')),
                                 ('completion', ('tick', 'machine', 'component', 'technician', 'kind')),
                                 ('failure', ('tick', 'machine', 'component')),
                                 ('occupancy', ('tick', 'machine', 'component', 'technician', 'remaining'))]:
                actual.append([tuple(e[k] for k in fields) for e in record['events'] if e['type'] == kind])
            if any(sorted(a) != sorted(b) for a, b in zip(actual, signatures)): invalid()
            for e in record['events']:
                if e['type'] == 'failure':
                    uniform = e['uniform']
                    expected = auditor.u01(seed, record['tick'], e['machine'], e['component'])
                    # Match the demo's legacy JSON-number tolerance while preserving the frozen value.
                    tolerance = 2 * math.ulp(expected) if type(uniform) in (int, float) else 0
                    if abs(float(uniform) - expected) > tolerance:
                        invalid()
                if e['type'] == 'start' and e['duration'] != cfg['duration'][e['machine']][e['component']][e['technician']]: invalid()
            previous = record['after']
            count += 1
        current = session[name]['state']
        if previous is not None:
            if previous['tick'] == current['tick']:
                if boundary(previous, name) != json_value(current): invalid()
            else: gaps.append({'lane': name, 'fromTick': previous['tick'], 'toTick': current['tick']})
    return {'status': 'PASS', 'scope': 'retained intervals and contiguous engineering boundaries only',
            'intervals': count, 'gaps': gaps, 'scientificComparison': 'UNSUPPORTED_WITH_INTERVENTIONS'}


def apply_due(session):
    """Apply a boundary exactly once, including the arrived boundary after a step."""
    tick = session['primary']['state']['tick']
    due = [e for e in session.get('incidents', []) if e['status'] == 'SCHEDULED' and e['scheduledTick'] <= tick]
    if not due:
        return
    if any(e['scheduledTick'] != tick for e in due):
        invalid()
    if session['status'] == 'REVIEW' or session.get('pending') is not None:
        raise SituationError('DEMO_REVIEW_REQUIRED')
    from .demo import note
    state = session['primary']['state']
    for e in due:
        machine = e['machineIndex']
        busy = any(j and j['machine'] == machine for j in state['jobs'])
        failed = any(c['failed'] for c in state['components'][machine])
        e['appliedTick'] = tick
        e['reason'] = 'MACHINE_IN_SERVICE' if busy else 'COMPONENT_ALREADY_FAILED' if failed else None
        e['status'] = 'SKIPPED' if e['reason'] else 'APPLIED'
        if not e['reason']:
            state['components'][machine][e['componentIndex']]['failed'] = True
            session['activated'] = True
            if session['first_incident_tick'] is None:
                session['first_incident_tick'] = tick
            for field in ('review_deferral', 'reviewDeferral', 'deferred_review'):
                if field in session:
                    session[field] = None
            note(session, 'INCIDENT', f"INJECTED {e['eventId']} at t{tick}: M{machine+1}/C{e['componentIndex']+1}.")


def inject(session, event):
    result = deepcopy(session)
    validate_session(result)
    if not result.get('branch') or result['status'] == 'COMPLETE':
        invalid()
    validate_event(event, result)
    tick = result['primary']['state']['tick']
    if event['status'] != 'SCHEDULED' or event['scheduledTick'] > min(2147483647, tick + 100000):
        invalid()
    if event['scheduledTick'] == tick and result['status'] == 'REVIEW':
        raise SituationError('DEMO_REVIEW_REQUIRED')
    previous = result.get('incidents', [])
    for old in previous:
        if old['eventId'] == event['eventId']:
            immutable = ('eventId', 'machineIndex', 'componentIndex', 'scheduledTick', 'requestedReason', 'createdBy', 'createdAt')
            if all(old[k] == event[k] for k in immutable):
                return result, deepcopy(old)
            invalid()
        if all(old[k] == event[k] for k in ('machineIndex', 'componentIndex', 'scheduledTick')):
            invalid()
    if len(previous) >= 1024:
        invalid()
    result['incidents'] = [*previous, deepcopy(event)]
    apply_due(result)
    return result, deepcopy(result['incidents'][-1])


def failure_counters(session):
    physics = session['primary']['failures']
    injected = sum(e['status'] == 'APPLIED' for e in session.get('incidents', []))
    return {'physics': physics, 'injected': injected, 'total': physics + injected}


def engineering_events(session):
    return [{'eventId': e['eventId'], 'source': 'INJECTED', 'type': 'failure',
             'tick': e['appliedTick'], 'machineIndex': e['machineIndex'],
             'componentIndex': e['componentIndex']} for e in session.get('incidents', []) if e['status'] == 'APPLIED']


def command(session, request, actor):
    from . import demo
    result = deepcopy(session)
    validate_session(result)
    name = request['command']
    if result['status'] == 'COMPLETE' and name != 'configure':
        invalid()
    if name == 'configure':
        demo.configure(result, request['primary'], request['baseline'], request['continuous'])
        apply_due(result)
    elif name == 'advance':
        if result['status'] == 'REVIEW':
            raise SituationError('DEMO_REVIEW_REQUIRED')
        demo.prepare(result)
        if request.get('autoApprove', False) and result['status'] == 'REVIEW':
            demo.commit(result, result['pending']['action'], 'automatic', 'Automatic policy confirmation')
    elif name == 'autoplay':
        demo.autoplay(result, request['stopAt'], request['maxTicks'])
    elif name in ('approve', 'override'):
        if result['status'] != 'REVIEW':
            raise SituationError('DEMO_REVIEW_REQUIRED')
        action = result['pending']['action'] if name == 'approve' else request['action']
        demo.commit(result, action, actor, request['reason'])
    else:
        invalid()
    validate_session(result, check_releases=False)
    return result


def execute(request):
    """Structured errors are valid protocol responses (process exit 0)."""
    try:
        if request.get('protocol') != PROTOCOL:
            invalid()
        operation = request['operation']
        if operation == 'demo_snapshot':
            return {'protocol': PROTOCOL, 'snapshot': snapshot(request['session'], request.get('context'), request.get('workOrders'), request.get('provenance'))}
        if operation == 'demo_situation_audit':
            validate_session(request['session'])
            return {'protocol': PROTOCOL, 'audit': audit_retained(request['session'])}
        if operation == 'demo_snapshot_restore':
            session = restore(request['snapshot'])
        elif operation == 'demo_incident':
            session, event = inject(request['session'], request['event'])
            return {'protocol': PROTOCOL, 'session': session, 'event': event,
                    'failureCounters': failure_counters(session), 'engineeringEvents': engineering_events(session)}
        elif operation == 'demo_situation_command':
            session = command(request['session'], request['command'], request['actor'])
        else:
            invalid()
        return {'protocol': PROTOCOL, 'session': session, 'failureCounters': failure_counters(session),
                'engineeringEvents': engineering_events(session)}
    except SituationError as error:
        return {'protocol': PROTOCOL, 'error': {'code': error.code}}
    except (ValueError, KeyError, TypeError, IndexError, AttributeError):
        return {'protocol': PROTOCOL, 'error': {'code': 'DEMO_SNAPSHOT_INCOMPATIBLE'}}
