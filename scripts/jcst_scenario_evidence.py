"""Classify recorded real-engine events. This module never simulates a tick."""


def classify(session, near_ticks=2):
    records = session['primary']['records']
    events = [event for record in records for event in record['events']]
    failures = [event for event in events if event['type'] == 'failure']
    starts = [event for event in events if event['type'] == 'start' and event['kind'] == 'CM']
    completions = [event for event in events if event['type'] == 'completion' and event['kind'] == 'CM']
    matches = {f'DEMO-0{i}': [] for i in range(1, 5)}
    alternatives = []
    for failure in failures:
        target = (failure['machine'], failure['component'])
        start = next((event for event in starts if (event['machine'], event['component']) == target
                      and event['tick'] >= failure['tick']), None)
        if start:
            end = next((event for event in completions if (event['machine'], event['component']) == target
                        and event['technician'] == start['technician'] and event['tick'] == start['tick'] + start['duration']), None)
            boundary = next((record for record in records if record['tick'] == start['tick']), None)
            if end and boundary and boundary['before']['jobs'][start['technician']] is None:
                matches['DEMO-01'].append({'failure': failure, 'start': start, 'completion': end,
                    'boundary': boundary['tick'], 'jobs': boundary['before']['jobs'],
                    'catalogue': boundary['catalogue'], 'action': boundary['action']})
    for i, first in enumerate(failures):
        for second in failures[i + 1:]:
            delta = second['tick'] - first['tick']
            if first['machine'] != second['machine'] and 0 <= delta <= near_ticks:
                boundary = next((record for record in records if record['tick'] == second['tick']), None)
                if boundary:
                    matches['DEMO-02'].append({'failures': [first, second], 'deltaTicks': delta,
                        'simultaneous': delta == 0, 'boundary': boundary['tick'],
                        'state': boundary['before'], 'catalogue': boundary['catalogue'], 'action': boundary['action']})
    for record in records:
        state = record['before']
        for m, components in enumerate(state['components']):
            for c, component in enumerate(components):
                if not component['failed']:
                    continue
                durations = session['config']['duration'][m][c]
                compatible = [j for j, duration in enumerate(durations) if duration > 0]
                busy = [j for j in compatible if state['jobs'][j] is not None]
                if not busy:
                    continue
                legal = sorted({a[2] for action in record['catalogue'] for a in action if a[:2] == [m, c] or tuple(a[:2]) == (m, c)})
                servicing = any(job and job['machine'] == m for job in state['jobs'])
                kind = 'MACHINE_IN_SERVICE' if servicing else 'FREE_ALTERNATIVE' if legal else 'WAIT_REQUIRED'
                evidence = {'boundary': record['tick'], 'machineIndex': m, 'componentIndex': c,
                    'classification': kind, 'duration': durations, 'compatibleBusy': busy,
                    'legalAvailableTechnicians': legal, 'jobs': state['jobs'],
                    'catalogue': record['catalogue'], 'action': record['action']}
                if kind == 'WAIT_REQUIRED':
                    matches['DEMO-03'].append(evidence)
                else:
                    alternatives.append(evidence)
    for completion in completions:
        failure = next((event for event in failures if event['machine'] != completion['machine']
                        and event['tick'] >= completion['tick']), None)
        if failure:
            matches['DEMO-04'].append({'completion': completion, 'failure': failure,
                'deltaTicks': failure['tick'] - completion['tick']})
    return {'matches': matches, 'resourceAlternatives': alternatives,
            'actor': 'automatic', 'browserAcceptance': 'NOT_RUN'}
