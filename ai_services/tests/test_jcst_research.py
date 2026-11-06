from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.jcst.contracts import Bundle, Config, Episode
from domain.jcst.runtime import audit_episode, branch_episode, generate_episode, modules, source_manifest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from export_jcst_bundle import engineering_bundle


@pytest.fixture(scope="module")
def episode():
    return generate_episode(horizon=12, tail=4)


def test_pinned_sources_and_independent_physical_replay(episode):
    assert len(source_manifest()["files"]) == 5
    report = audit_episode(episode)
    assert report["status"] == "PASS" and report["records"] == 16
    assert episode.total_cost == episode.controlled_cost + episode.tail_cost


def test_large_seeds_are_exact_and_numbers_are_rejected():
    seed = str(2**64 + 9007199254740993)
    episode = generate_episode(seed=seed, horizon=4, tail=2)
    assert Episode.model_validate_json(episode.model_dump_json()).physical_seed == seed
    assert audit_episode(episode)["status"] == "PASS"
    raw = episode.model_dump(); raw["physical_seed"] = int(seed)
    with pytest.raises(ValidationError): Episode.model_validate(raw)


@pytest.mark.parametrize("tamper", ["cost", "state", "action", "catalogue", "events", "phase"])
def test_corruption_does_not_pass_replay(episode, tamper):
    raw = episode.model_dump(exclude_none=True)
    if tamper == "cost": raw["records"][0]["cost"] += 1
    if tamper == "state": raw["records"][0]["after"]["components"][0][0]["age"] += 1
    if tamper == "action": raw["records"][0]["action"] = [[0,0,0],[1,0,0]]
    if tamper == "catalogue": raw["records"][0]["catalogue"] = [[]]
    if tamper == "events": raw["records"][5]["events"] = []
    if tamper == "phase": raw["records"][0]["phase"] = "tail"
    with pytest.raises((ValidationError, ValueError)):
        audit_episode(Episode.model_validate(raw))


def test_target_only_reset_and_downtime_age_freeze():
    p, _ = modules(); cfg = p.engineering_config(); s = p.initial_state(cfg)
    from dataclasses import replace
    components = [list(row) for row in s.components]
    components[0] = [p.ComponentState(8, True), p.ComponentState(7, True)]
    s = replace(s, components=tuple(tuple(row) for row in components))
    first = p.transition(cfg,s,((0,0,0),),99900001)
    assert first.state.jobs[0].remaining == 1
    assert first.state.components[0][1].age == 7
    with pytest.raises(ValueError): p.transition(cfg,first.state,((1,0,0),),99900001)
    second = p.transition(cfg, first.state, (), 99900001)
    assert second.state.components[0][0] == p.ComponentState(0,False)
    assert second.state.components[0][1] == p.ComponentState(7,True)
    assert p.machine_modes(second.state)[0] == "breakdown"


def test_branch_preserves_source_and_common_physical_noise(episode):
    before = episode.model_dump_json()
    result = branch_episode(episode, 3, [], "risk")
    assert episode.model_dump_json() == before
    assert result.records[:3] == episode.records[:3]
    assert result.physical_seed == episode.physical_seed
    assert audit_episode(result)["status"] == "PASS"
    with pytest.raises(ValueError): branch_episode(episode, episode.horizon, [], "risk")
    with pytest.raises(ValueError): branch_episode(episode, 0, [[0,0,0],[1,0,0]], "risk")


def test_branch_comparison_uses_matched_continuation_for_both_paths(episode):
    from jcst_bridge import execute
    # At tick zero risk chooses WAIT. An identical override must have zero delta
    # even if the original episode used threshold5 as its future controller.
    result=execute(dict(operation="branch",episode=episode.model_dump(mode="json"),tick=0,action=[],controller="risk"))
    assert result["episode"]["total_cost"] == result["baseline"]["total_cost"]
    assert result["episode"]["physical_seed"] == result["baseline"]["physical_seed"]
    assert result["audit"]["status"] == result["baseline_audit"]["status"] == "PASS"


def test_bundle_artifact_integrity_and_strict_family():
    bundle = engineering_bundle(); assert len(bundle.episodes) == 1
    data = bundle.model_dump()
    data["artifacts"][0]["content"] += "changed"
    with pytest.raises(ValidationError): Bundle.model_validate(data)
    data = bundle.model_dump(); data["wire_schema_version"] = "2.0"
    with pytest.raises(ValidationError): Bundle.model_validate(data)
    data = bundle.model_dump(); data["episodes"][0]["seed_role"] = "evaluation"
    with pytest.raises(ValidationError): Bundle.model_validate(data)


def test_results_cannot_disagree_with_retained_projection_artifact():
    b = engineering_bundle().model_dump()
    projection = json.dumps({"format":"jcst-analysis-projection/1.0", "source_artifact_ids":["engineering-protocol"],
                            "curves":[], "contrasts":[]})
    b["artifacts"].append(dict(artifact_id="analysis", media_type="application/json",content=projection,
                              sha256=hashlib.sha256(projection.encode()).hexdigest()))
    b["analysis_artifact_id"] = "analysis"
    b["curves"] = [dict(case_id="base",arm="A",training_root="0",samples=24,mean_total_cost=1)]
    with pytest.raises(ValidationError, match="projection"): Bundle.model_validate(b)


@pytest.mark.parametrize("field,value", [("duration", [[[0,0],[8,2]]]*3), ("preventive_cost", float("nan")), ("version", "old")])
def test_invalid_physical_config_is_rejected(episode, field, value):
    config = episode.config.model_dump(); config[field] = value
    with pytest.raises(ValidationError): Config.model_validate(config)
