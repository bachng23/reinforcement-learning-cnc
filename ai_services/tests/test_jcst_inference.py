"""Checkpoint mapping/parity tests. No optimizer, training or scientific evaluation."""
from dataclasses import asdict, replace
import hashlib
import importlib
import json
import os
from pathlib import Path

import pytest

torch = pytest.importorskip("torch", reason="isolated JCST inference runtime is optional")
from domain.jcst.contracts import Config, State
from domain.jcst.runtime import infer, modules, source_manifest


def setup(case, arm):
    physics, controls = modules()
    learner = importlib.import_module("ht_pdm_fjsp.jcst_learner_v1")
    cfg = physics.engineering_config()
    if case == "generalist": cfg = replace(cfg, duration=tuple(((2,8,5),(8,2,5)) for _ in range(3)))
    universe=learner.action_universe(cfg)
    policy=learner.Policy(arm,cfg,universe)
    states=[physics.initial_state(cfg)]
    state=states[0]
    for tick in range(12):
        action=controls.Threshold(5).choose(controls.observe(cfg,state,48,16)).action
        state=physics.transition(cfg,state,action,990000009).state
        if tick in (4,6,10): states.append(state)
    return physics,learner,cfg,universe,policy,states


@pytest.mark.parametrize("case",["base","generalist"])
@pytest.mark.parametrize("arm",["S","A","F"])
def test_checkpoint_adapter_matches_source_and_rejects_mismatches(tmp_path,case,arm):
    torch.manual_seed(900); torch.set_num_threads(1)
    physics,learner,cfg,universe,policy,states=setup(case,arm)
    path=tmp_path/'weights.pt'; torch.save(policy.state_dict(),path)
    config=Config.model_validate(asdict(cfg))
    release=dict(path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),arm=arm,
                 config_hash=hashlib.sha256(json.dumps(config.model_dump(),sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                 catalogue_hash=hashlib.sha256(json.dumps(universe,separators=(',',':')).encode()).hexdigest(),
                 source_commit=source_manifest()['commit'],torch_version='2.14.0',horizon=48,tail=16)
    for state in states:
        expected=universe[learner.choose(policy,learner.encode(cfg,state,universe),deterministic=True)[0]]
        actual=infer(config,State.model_validate(asdict(state)),release)
        assert actual['action']==expected
        assert actual['mode']=='greedy'
    for changed in ({'sha256':'0'*64},{'config_hash':'0'*64},{'catalogue_hash':'0'*64},{'source_commit':'0'*40},{'torch_version':'wrong'}):
        with pytest.raises(ValueError): infer(config,State.model_validate(asdict(states[0])),{**release,**changed})
    with pytest.raises(ValueError): infer(config,State.model_validate(asdict(states[0])),release,24,8)


@pytest.mark.skipif(not os.environ.get('JCST_TEST_RELEASE_REGISTRY'),reason='historical checkpoints supplied explicitly only')
def test_registered_historical_weights_match_on_new_engineering_states():
    path=Path(os.environ['JCST_TEST_RELEASE_REGISTRY']); registry=json.loads(path.read_text())
    assert len(registry)==6
    for release in registry.values():
        _,learner,cfg,universe,policy,states=setup(release['case_id'],release['arm'])
        release={**release,'path':str(path.parent/release['path'])}
        policy.load_state_dict(torch.load(release['path'],map_location='cpu',weights_only=True))
        for state in states:
            expected=universe[learner.choose(policy,learner.encode(cfg,state,universe),deterministic=True)[0]]
            assert infer(Config.model_validate(asdict(cfg)),State.model_validate(asdict(state)),release)['action']==expected
