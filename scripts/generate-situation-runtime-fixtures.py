"""Deterministic real-engine evidence for the approved situation protocol."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ai_services'))
from domain.jcst import demo, situations as s

p = json.loads(json.dumps(demo.initialize('base', '990000001', 'policy', 'corrective', 'wait', True)))
p['simulation_start'] = '2026-11-16T00:00:00Z'
p['branch'] = {'branchId': '00000000-0000-4000-8000-000000000002'}
healthy = s.snapshot(p, {'layoutId': 'smt-board-assembly'}, provenance={'sourceTick': 0})
event = {'eventId': '00000000-0000-4000-8000-000000000003', 'machineIndex': 2,
         'componentIndex': 1, 'scheduledTick': 0, 'status': 'SCHEDULED', 'appliedTick': None,
         'reason': None, 'requestedReason': 'Controlled repair exercise',
         'createdBy': '00000000-0000-4000-8000-000000000001', 'createdAt': p['simulation_start']}
p, applied = s.inject(s.restore(healthy), event)
after_injection = json.loads(json.dumps(p))
demo.prepare(p)
review = s.snapshot(p)
p = s.command(p, {'command': 'approve', 'reason': 'Approve corrective matching'}, event['createdBy'])
repair = s.snapshot(p)
assert p['primary']['state']['jobs'][1]['remaining'] == 1
p = s.command(p, {'command': 'advance', 'autoApprove': True}, event['createdBy'])
assert p['primary']['state']['jobs'][1] is None
audit = s.audit_retained(p)
out = ROOT / 'ai_services/tests/fixtures/jcst-situations-runtime.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'protocol': s.PROTOCOL, 'evidence': 'REAL_BUILTIN_POLICY_RUNTIME',
    'healthy': healthy, 'incidentRequest': event, 'afterInjection': after_injection,
    'review': review, 'repairRemainingOne': repair, 'completed': p,
    'audit': audit, 'failureCounters': s.failure_counters(p)}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'fixture': str(out), 'audit': audit, 'ticks': [0, 1, 2]}))
