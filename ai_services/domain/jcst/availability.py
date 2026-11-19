"""Engineering workforce calendar; physical jobs and vendor policy features stay intact."""
from copy import deepcopy
from uuid import UUID

from .situations import SituationError

PROTOCOL = 'jcst-technicians/1'
VERSION = 'jcst-technician-availability/1'


def invalid():
    raise SituationError('DEMO_SNAPSHOT_INCOMPATIBLE')


def uint(value):
    return type(value) is int and 0 <= value <= 2147483647


def uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value.lower()
    except (ValueError, AttributeError):
        return False


def empty():
    return dict(schemaVersion=VERSION, version=0, absences=[], events=[], origin=None)


def metadata(session, due_allowed=False):
    m = session.get('technicianAvailability', empty())
    if not isinstance(m, dict) or set(m) != {'schemaVersion', 'version', 'absences', 'events', 'origin'} or m['schemaVersion'] != VERSION or not uint(m['version']):
        invalid()
    n = len(session['primary']['state']['jobs'])
    tick = session['primary']['state']['tick']
    if len(session['baseline']['state']['jobs']) != n or any(len(row) != n for machine in session['config']['duration'] for row in machine): invalid()
    if not isinstance(m['events'], list) or not isinstance(m['absences'], list) or len(m['events']) > 2048 or len(m['absences']) > 1024: invalid()
    events, ids, windows = {}, set(), {}
    last, user_events, consumed = -1, [], 0
    for e in m['events']:
        if not isinstance(e, dict) or set(e) != {'eventId', 'technicianIndex', 'type', 'tick', 'actor', 'reason'}: invalid()
        if not uuid(e['eventId']) or e['eventId'] in events or not uint(e['technicianIndex']) or e['technicianIndex'] >= n or not uint(e['tick']) or not last <= e['tick'] <= tick: invalid()
        if not isinstance(e['reason'], str) or not 1 <= len(e['reason'].strip()) <= 1000 or e['reason'] != e['reason'].strip(): invalid()
        a = e['actor']
        if not isinstance(a, dict) or set(a) != {'type', 'userId'}: invalid()
        if e['type'] == 'ABSENCE_ENDED':
            if a != {'type': 'SYSTEM', 'userId': None} or e['reason'] != 'Absence interval elapsed': invalid()
        elif e['type'] in ('ABSENCE_STARTED', 'ABSENCE_RETURNED_EARLY'):
            if a['type'] != 'USER' or not uuid(a['userId']): invalid()
            user_events.append(e)
        else: invalid()
        last = e['tick']; events[e['eventId']] = e
    for a in m['absences']:
        if not isinstance(a, dict) or set(a) != {'eventId', 'automaticEndEventId', 'technicianIndex', 'startTick', 'returnTick', 'endedTick', 'endedByEventId'}: invalid()
        if not all(uint(a[k]) for k in ('technicianIndex', 'startTick', 'returnTick')) or a['technicianIndex'] >= n or not a['startTick'] <= tick or not a['startTick'] < a['returnTick'] <= a['startTick'] + 100000: invalid()
        if not all(uuid(a[k]) for k in ('eventId', 'automaticEndEventId')) or a['eventId'] == a['automaticEndEventId'] or ids.intersection((a['eventId'], a['automaticEndEventId'])): invalid()
        ids.update((a['eventId'], a['automaticEndEventId']))
        start = events.get(a['eventId'])
        if not start or start['type'] != 'ABSENCE_STARTED' or start['tick'] != a['startTick'] or start['technicianIndex'] != a['technicianIndex']: invalid()
        consumed += 1
        if a['endedTick'] is None:
            if a['endedByEventId'] is not None or (tick >= a['returnTick'] and not due_allowed): invalid()
        else:
            end = events.get(a['endedByEventId'])
            if not uint(a['endedTick']) or not a['startTick'] <= a['endedTick'] <= min(a['returnTick'], tick) or not end or end['tick'] != a['endedTick'] or end['technicianIndex'] != a['technicianIndex']: invalid()
            if end['type'] == 'ABSENCE_ENDED':
                if end['eventId'] != a['automaticEndEventId'] or a['endedTick'] != a['returnTick']: invalid()
            elif end['type'] != 'ABSENCE_RETURNED_EARLY' or a['endedTick'] >= a['returnTick']: invalid()
            consumed += 1
        if a['startTick'] < windows.get(a['technicianIndex'], -1): invalid()
        windows[a['technicianIndex']] = a['endedTick'] if a['endedTick'] is not None else a['returnTick']
    if consumed != len(events) or m['version'] != len(user_events): invalid()
    expected = dict(eventId=user_events[-1]['eventId'], tick=user_events[-1]['tick'], workforceVersion=m['version']) if user_events else None
    if m['origin'] != expected: invalid()
    return m


def absent(session, technician, tick):
    return any(a['technicianIndex'] == technician and a['startTick'] <= tick < (a['returnTick'] if a['endedTick'] is None else a['endedTick'])
               for a in session.get('technicianAvailability', {}).get('absences', []))


def catalogue(session, cfg, state):
    from .runtime import modules
    physics, _ = modules()
    return tuple(a for a in physics.legal_actions(cfg, state) if all(not absent(session, e[2], state.tick) for e in a))


def validate_action(session, cfg, state, action):
    from .runtime import modules
    canonical = modules()[0].canonical_action(cfg, state, action)
    if canonical not in catalogue(session, cfg, state): invalid()
    return canonical


def clear_review(session):
    session.update(pending=None, status='RUNNING', playbackPaused=True)
    for key in ('review_deferral', 'reviewDeferral', 'deferred_review'):
        if key in session: session[key] = None


def expire(session):
    if 'technicianAvailability' not in session: return
    m = metadata(session, due_allowed=True)
    tick = session['primary']['state']['tick']
    due = sorted((a for a in m['absences'] if a['endedTick'] is None and a['returnTick'] <= tick), key=lambda a: (a['returnTick'], m['absences'].index(a)))
    for a in due:
        if a['returnTick'] != tick: invalid()  # Never silently skip internal boundaries.
        a.update(endedTick=tick, endedByEventId=a['automaticEndEventId'])
        m['events'].append(dict(eventId=a['automaticEndEventId'], technicianIndex=a['technicianIndex'], type='ABSENCE_ENDED', tick=tick,
                              actor=dict(type='SYSTEM', userId=None), reason='Absence interval elapsed'))
    if due and session.get('pending') is not None: clear_review(session)
    metadata(session)


def change(session, planned):
    from .situations import validate_session
    validate_session(session)
    old = metadata(session)
    result = deepcopy(session); result['technicianAvailability'] = deepcopy(planned)
    metadata(result)
    tick = session['primary']['state']['tick']
    if session['status'] == 'COMPLETE' or planned['version'] != old['version'] + 1 or planned['events'][:-1] != old['events']: invalid()
    event = planned['events'][-1]; index = event['technicianIndex']
    if event['tick'] != tick or event['actor']['type'] != 'USER': invalid()
    if event['type'] == 'ABSENCE_STARTED':
        if session['primary']['state']['jobs'][index] is not None: raise SituationError('TECHNICIAN_BUSY')
        if absent(session, index, tick): raise SituationError('TECHNICIAN_ALREADY_ABSENT')
        if planned['absences'][:-1] != old['absences'] or planned['absences'][-1]['eventId'] != event['eventId'] or planned['absences'][-1]['endedTick'] is not None: invalid()
    elif event['type'] == 'ABSENCE_RETURNED_EARLY':
        if not absent(session, index, tick): raise SituationError('TECHNICIAN_NOT_ABSENT')
        expected = deepcopy(old['absences'])
        current = next(a for a in expected if a['technicianIndex'] == index and a['endedTick'] is None)
        current.update(endedTick=tick, endedByEventId=event['eventId'])
        if planned['absences'] != expected: invalid()
    else: invalid()
    clear_review(result)
    return result


def summary(session):
    metadata(session)
    tick = session['primary']['state']['tick']
    return [dict(technicianIndex=i, availability='BUSY' if job else 'ABSENT' if absent(session, i, tick) else 'AVAILABLE')
            for i, job in enumerate(session['primary']['state']['jobs'])]


def repair_warnings(session, lane_name='primary'):
    """State-derived reasons; an absent idle specialist is never free capacity."""
    lane = session[lane_name]; state = lane['state']; tick = state['tick']
    result = []
    for machine, row in enumerate(state['components']):
        if any(j and j['machine'] == machine for j in state['jobs']): continue
        for component, item in enumerate(row):
            if not item['failed']: continue
            durations = session['config']['duration'][machine][component]
            reasons = ['NOT_QUALIFIED' if duration <= 0 else 'BUSY' if state['jobs'][i] else 'ABSENT' if absent(session, i, tick) else 'AVAILABLE'
                       for i, duration in enumerate(durations)]
            available = [i for i, reason in enumerate(reasons) if reason == 'AVAILABLE']
            if not available:
                result.append(dict(machineIndex=machine, componentIndex=component, reason='NO_AVAILABLE_QUALIFIED_TECHNICIAN',
                                   technicians=[dict(technicianIndex=i, reason=reason) for i, reason in enumerate(reasons)]))
    return result


def execute(request):
    from . import situations
    try:
        if request.get('protocol') != PROTOCOL: invalid()
        op = request['operation']
        if op == 'demo_technician_change': result = change(request['session'], request['metadata'])
        elif op == 'demo_technician_command': result = situations.command(request['session'], request['command'], request['actor'])
        elif op == 'demo_technician_restore': result = situations.restore(request['snapshot'])
        elif op == 'demo_technician_incident':
            result, event = situations.inject(request['session'], request['event'])
            return dict(protocol=PROTOCOL, session=result, event=event)
        elif op == 'demo_technician_summary':
            situations.validate_session(request['session'])
            return dict(protocol=PROTOCOL, technicians=summary(request['session']), repairWarnings=repair_warnings(request['session']))
        else: invalid()
        return dict(protocol=PROTOCOL, session=result, repairWarnings=repair_warnings(result))
    except SituationError as error:
        return dict(protocol=PROTOCOL, error=dict(code=error.code))
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, StopIteration):
        return dict(protocol=PROTOCOL, error=dict(code='DEMO_SNAPSHOT_INCOMPATIBLE'))
