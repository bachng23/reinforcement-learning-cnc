"""Capture physical evidence only; not a substitute for API/database acceptance."""
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ai_services'))
from domain.jcst.demo import initialize, prepare, commit


def generate():
    session = initialize(case='base', seed='990000001', mode='policy',
                         primary='corrective', baseline='wait', continuous=True)
    while session['primary']['state']['tick'] < 5:
        prepare(session)
        if session['status'] == 'REVIEW':
            assert session['pending']['action'] == [], 'Unexpected pre-failure dispatch'
            commit(session, [], 'fixture-operator', 'Defer preventive work')
    if session['status'] != 'REVIEW':
        prepare(session)
    assert session['primary']['state']['tick'] == 5
    assert [2, 1, 1] in [list(a) for a in session['pending']['action']]
    assert not any(e['type'] == 'start' and e['machine'] == 2
                   for r in session['primary']['records'] for e in r['events'])
    snapshots = {'beforeApproval': copy.deepcopy(session)}
    commit(session, session['pending']['action'], 'fixture-operator', 'Approve corrective matching')
    assert session['primary']['state']['tick'] == 6
    job = session['primary']['state']['jobs'][1]
    assert job['machine'] == 2 and job['component'] == 1 and job['remaining'] == 1
    snapshots['inProgress'] = copy.deepcopy(session)
    prepare(session)
    if session['status'] == 'REVIEW':
        commit(session, session['pending']['action'], 'fixture-operator', 'Approve next matching')
    assert session['primary']['state']['tick'] == 7
    assert any(e['type'] == 'completion' and e['machine'] == 2 and
               e['component'] == 1 and e['technician'] == 1 and e['tick'] == 7
               for e in session['primary']['records'][-1]['events'])
    snapshots['completed'] = copy.deepcopy(session)
    for snapshot in snapshots.values():
        # Exclude wall-clock values so regeneration is byte reproducible.
        snapshot.pop('simulation_start', None)
    result = {'fixtureVersion': 1, 'evidenceKind': 'REAL_SIMULATOR_TRACE',
              'apiDatabaseVerified': False, 'snapshots': snapshots}
    destination = ROOT / 'backend/examples/demo-work-orders-trace.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('Verified real-engine milestones: t5 review, t6 remaining=1, t7 completion')


if __name__ == '__main__':
    generate()
