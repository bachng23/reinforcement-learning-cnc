"""Deterministic fixture producer using byte-verified JCST, never inference."""
import copy
import hashlib
import json
from dataclasses import asdict
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / 'ai_services/vendor/jcst'
manifest = json.loads((VENDOR / 'manifest.json').read_text())
verified = tempfile.TemporaryDirectory(prefix='jcst-health-fixture-')
for name, entry in manifest['files'].items():
    raw = (VENDOR / name).read_bytes()
    # Windows checkouts may have CRLF. Verify exact canonical bytes before use;
    # never mutate the checkout or weaken the production manifest verifier.
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raw = raw.replace(b'\r\n', b'\n')
    assert hashlib.sha256(raw).hexdigest() == entry['sha256'], name
    target = Path(verified.name) / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
sys.path.insert(0, verified.name)
from ht_pdm_fjsp import component_service_v1 as physics
from ht_pdm_fjsp import component_controllers_v1 as controls

config = physics.engineering_config()
state = physics.initial_state(config)
records, rows = [], {}
SESSION = 'd549829e-27cc-4f33-855e-100000000001'

def row(state, records, revision):
    return dict(id=SESSION, revision=revision, payloadJson=dict(
        step_seconds=900, config=asdict(config),
        primary=dict(state=asdict(state), records=copy.deepcopy(records))))

def step(state, action):
    result = physics.transition(config, state, action, 990000001)
    return result.state, dict(tick=state.tick, before=asdict(state), after=asdict(result.state),
                             events=list(result.events))

rows['0'] = row(state, [], 0)
for tick in range(7):
    action = controls.Corrective().choose(controls.observe(config, state, tick + 48, 16)).action
    state, record = step(state, action)
    records.append(record)
    # API prepare review + explicit approve: no automatic approvals.
    if state.tick in (5, 6, 7):
        rows[str(state.tick)] = row(state, records, state.tick * 2)

assert rows['5']['payloadJson']['primary']['state']['components'][2][1]['failed']
assert any(e['type'] == 'start' and e['tick'] == 5 and e['machine'] == 2
           and e['component'] == 1 and e['technician'] == 1 and e['kind'] == 'CM'
           for r in records for e in r['events'])
assert any(e['type'] == 'completion' and e['tick'] == 7 and e['machine'] == 2
           and e['component'] == 1 for r in records for e in r['events'])

pm = physics.initial_state(config)
pm_records = []
for action in (((2, 1, 1),), ()):
    pm, record = step(pm, action)
    pm_records.append(record)

data = dict(sourceCommit=manifest['commit'], simulatorVersion=manifest['simulator_version'],
            scenario=dict(case='base', seed='990000001', mode='policy', primary='corrective',
                          baseline='wait', continuous=True),
            rows=rows, pm=row(pm, pm_records, 4),
            hazardOracle=[dict(spec=asdict(spec), age=age, risk=physics.hazard(spec, age))
                          for specs in config.components for spec in specs for age in (0, 4, 17)])
target = ROOT / 'backend/tests/fixtures/machine-health/source.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(data, indent=2) + '\n', encoding='utf8')
print('Verified JCST source; wrote deterministic physical traces and hazard oracle.')
