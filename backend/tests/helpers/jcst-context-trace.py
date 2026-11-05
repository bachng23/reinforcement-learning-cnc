"""Real pinned physics fixture, explicit legal matching, no learned-policy claim."""
import copy
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'ai_services'))
from domain.jcst.runtime import modules, source_manifest

physics, _ = modules()
cfg = physics.engineering_config()
state = physics.initial_state(cfg)
records = []
decisions = []
snapshots = []
for tick in range(8):
    selected = ((0, 0, 0), (2, 1, 1)) if tick == 5 else ()
    if tick == 5:
        decisions.append(dict(tick=tick, actor='fixture-reviewer', reason='Explicit legal matching for physical trace test',
                              action=selected, proposed_action=selected, override=False))
    result = physics.transition(cfg, state, selected, 990000001)
    records.append(dict(tick=tick, before=asdict(state), after=asdict(result.state), action=selected,
                        catalogue=physics.legal_actions(cfg, state), phase='H', cost=result.cost, breakdown=result.breakdown,
                        events=[{**e, 'uniform': repr(e['uniform'])} if e['type'] == 'failure' else e for e in result.events]))
    state = result.state
    lane = dict(state=asdict(state), records=copy.deepcopy(records), controller='explicit-test-matching')
    snapshots.append(dict(status='RUNNING', primary=lane, baseline=copy.deepcopy(lane), decisions=copy.deepcopy(decisions),
                          config=asdict(cfg), source_commit=source_manifest()['commit'], physical_seed='990000001'))
print(json.dumps(snapshots))
