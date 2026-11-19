"""M0 feasibility probe; synthetic weights are NOT registered-policy acceptance."""
import importlib
import json
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ai_services'))
import numpy as np
import torch
from domain.jcst.runtime import modules

physics, controls = modules()
learner = importlib.import_module('ht_pdm_fjsp.jcst_learner_v1')
cfg = physics.engineering_config()
state = physics.initial_state(cfg)
universe = learner.action_universe(cfg)
encoded = learner.encode(cfg, state, universe)
torch.set_num_threads(1)
results = []
for absent in (set(), {0}, {1}, {0, 1}):
    catalogue = tuple(a for a in physics.legal_actions(cfg, state)
                      if all(edge[2] not in absent for edge in a))
    mask = encoded.mask & np.asarray([a in catalogue for a in universe])
    constrained = replace(encoded, mask=mask)
    assert mask[0] and int(mask.sum()) == len(catalogue)
    assert np.array_equal(constrained.flat, encoded.flat)
    assert np.array_equal(constrained.technician, encoded.technician)
    for arm in ('S', 'A', 'F'):
        torch.manual_seed(990000001)
        policy = learner.Policy(arm, cfg, universe)
        policy.eval()
        with torch.no_grad():
            action = universe[int(learner.choose(policy, constrained, deterministic=True)[0])]
            assert action in catalogue
            if not absent:
                assert action == universe[int(learner.choose(policy, encoded, deterministic=True)[0])]
    obs = replace(controls.observe(cfg, state, 48, 16), actions=catalogue)
    for policy in (controls.Wait(), controls.Corrective(), controls.Threshold(5), controls.RiskMatching()):
        assert policy.choose(obs).action in catalogue
    results.append({'absent': sorted(absent), 'legalMatchings': len(catalogue),
                    'S_A_F_synthetic_mask_shape': 'PASS', 'heuristics': 'PASS'})
print(json.dumps({'scope': 'M0 feasibility, synthetic weights only', 'checks': results}, indent=2))
