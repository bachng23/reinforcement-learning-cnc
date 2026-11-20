"""Deterministic real-runtime M0/M1 wire examples, never an integration fallback."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ai_services'))
from domain.jcst import demo, availability as a, situations as s

p = json.loads(json.dumps(demo.initialize('base', '990000001', 'policy', 'corrective', 'wait', True)))
p['simulation_start'] = '2026-11-19T00:00:00Z'
actor = dict(type='USER', userId='00000000-0000-4000-8000-000000000001')
eid = '00000000-0000-4000-8000-000000000002'
end = '00000000-0000-4000-8000-000000000003'
m = dict(schemaVersion=a.VERSION, version=1, absences=[dict(eventId=eid, automaticEndEventId=end, technicianIndex=0,
         startTick=0, returnTick=3, endedTick=None, endedByEventId=None)],
         events=[dict(eventId=eid, technicianIndex=0, type='ABSENCE_STARTED', tick=0, actor=actor, reason='Three-step engineering absence')],
         origin=dict(eventId=eid, tick=0, workforceVersion=1))
absent = a.change(p, m)
expired = s.command(absent, dict(command='autoplay', stopAt='complete', maxTicks=3), 'automatic')
result = dict(protocol=a.PROTOCOL, scope='real heuristic runtime, seed 990000001',
              changeRequest=dict(protocol=a.PROTOCOL, operation='demo_technician_change', session=p, metadata=m),
              absentResponse=dict(protocol=a.PROTOCOL, session=absent),
              snapshot=s.snapshot(absent), expiredResponse=dict(protocol=a.PROTOCOL, session=expired),
              audit=s.audit_retained(expired))
target = ROOT / 'ai_services/tests/fixtures/jcst-technician-runtime.json'
target.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf8')
print(target)
