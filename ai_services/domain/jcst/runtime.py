"""Bridge to byte-verified, unchanged upstream JCST sources. No training entry point."""
from __future__ import annotations

from dataclasses import asdict
import hashlib
import importlib
import json
from pathlib import Path
import sys

from .contracts import Config, Episode, State

SOURCE = Path(__file__).resolve().parents[2] / "vendor" / "jcst"


def source_manifest() -> dict:
    manifest = json.loads((SOURCE / "manifest.json").read_text())
    for name, entry in manifest["files"].items():
        if hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"pinned JCST source mismatch: {name}")
    return manifest


def modules():
    source_manifest()
    if str(SOURCE) not in sys.path:
        sys.path.insert(0, str(SOURCE))
    physics = importlib.import_module("ht_pdm_fjsp.component_service_v1")
    if Path(physics.__file__).resolve() != SOURCE / "ht_pdm_fjsp/component_service_v1.py":
        raise ValueError("JCST namespace is shadowed by another installation")
    return physics, importlib.import_module("ht_pdm_fjsp.component_controllers_v1")


def raw_config(config: Config):
    physics, _ = modules()
    return physics.config_from_json(config.model_dump_json())


def raw_state(config, state: State):
    physics, _ = modules()
    return physics.state_from_json(config, state.model_dump_json())


def controller(name: str):
    _, controls = modules()
    constructors = {"threshold5": lambda: controls.Threshold(5), "risk": controls.RiskMatching,
                    "corrective": controls.Corrective, "wait": controls.Wait}
    if name not in constructors:
        raise ValueError("controller unavailable")
    return constructors[name]()


def audit_episode(episode: Episode) -> dict:
    """Independent raw-record replay; never calls the collector transition."""
    physics, controls = modules()
    auditor = importlib.import_module("jcst_replay_audit")
    cfg = episode.config.model_dump()
    canonical_cfg = raw_config(episode.config)
    for record in episode.records:
        before = record.before.model_dump()
        raw_state(canonical_cfg, record.before)
        action = tuple(tuple(e) for e in record.action)
        catalogue = auditor.catalogue(cfg, before)
        observed = {tuple(tuple(e) for e in a) for a in record.catalogue}
        if action != tuple(sorted(action)) or action not in catalogue or observed != catalogue or len(observed) != len(record.catalogue):
            raise ValueError(f"action/catalogue mismatch at tick {record.tick}")
        after, costs, groups = auditor.independent_step(cfg, before, action, int(episode.physical_seed))
        if after != record.after.model_dump() or costs != record.breakdown.model_dump():
            raise ValueError(f"independent state/cost replay mismatch at tick {record.tick}")
        events = record.model_dump(exclude_none=True)["events"]
        for event in events:
            if event["type"] == "failure" and event["uniform"] != auditor.u01(int(episode.physical_seed), record.tick, event["machine"], event["component"]):
                raise ValueError("failure event physical uniform mismatch")
            if event["type"] == "start" and event["duration"] != cfg["duration"][event["machine"]][event["component"]][event["technician"]]:
                raise ValueError("service duration event mismatch")
        signatures = (
            [(e["tick"], e["machine"], e["component"], e["technician"], e["kind"]) for e in events if e["type"] == "start"],
            [(e["tick"], e["machine"], e["component"], e["technician"], e["kind"]) for e in events if e["type"] == "completion"],
            [(e["tick"], e["machine"], e["component"]) for e in events if e["type"] == "failure"],
            [(e["tick"], e["machine"], e["component"], e["technician"], e["remaining"]) for e in events if e["type"] == "occupancy"],
        )
        if any(sorted(a) != sorted(b) for a, b in zip(signatures, groups)):
            raise ValueError(f"independent event replay mismatch at tick {record.tick}")
        if record.phase == "tail":
            expected = controls.RiskMatching().choose(controls.observe(canonical_cfg, raw_state(canonical_cfg, record.before), episode.horizon, episode.tail)).action
            if action != expected:
                raise ValueError("tail controller differs from fixed risk")
    return {"status": "PASS", "scope": "independent physical replay of included episodes only",
            "records": len(episode.records), "source_commit": source_manifest()["commit"]}


def generate_episode(case: str = "base", name: str = "threshold5", seed: str = "990000001", horizon: int = 48, tail: int = 16) -> Episode:
    physics, _ = modules()
    framework = importlib.import_module("ht_pdm_fjsp.component_framework_v1")
    cfg = physics.engineering_config()
    if case == "generalist":
        from dataclasses import replace
        cfg = replace(cfg, duration=tuple(((2, 8, 5), (8, 2, 5)) for _ in range(3)))
    elif case != "base":
        raise ValueError("supported cases: base/generalist")
    raw = framework.run_episode(cfg, controller(name), int(seed), horizon, tail)
    for record in raw["records"]:
        record.pop("decision", None)
    return Episode(episode_id=f"engineering-{case}-{name}-{seed}", case_id=case, controller=name,
                   physical_seed=seed, seed_role="engineering", horizon=horizon, tail=tail,
                   config=asdict(cfg), records=raw["records"], controlled_cost=raw["controlled_cost"],
                   tail_cost=raw["tail_cost"], total_cost=raw["total_cost"])


def branch_episode(episode: Episode, tick: int, action: list, name: str) -> Episode:
    if tick >= episode.horizon:
        raise ValueError("override must be inside controlled horizon")
    physics, controls = modules()
    cfg = raw_config(episode.config)
    state = raw_state(cfg, episode.records[tick].before)
    chosen = physics.canonical_action(cfg, state, action)
    records = [r.model_dump(exclude_none=True) for r in episode.records[:tick]]
    for t in range(tick, episode.horizon + episode.tail):
        current = chosen if t == tick else (controller(name) if t < episode.horizon else controls.RiskMatching()).choose(
            controls.observe(cfg, state, episode.horizon, episode.tail)).action
        result = physics.transition(cfg, state, current, int(episode.physical_seed))
        records.append(dict(phase="H" if t < episode.horizon else "tail", tick=t,
                            before=asdict(state), action=current, catalogue=physics.legal_actions(cfg, state),
                            after=asdict(result.state), cost=result.cost, breakdown=result.breakdown, events=result.events))
        state = result.state
    h = sum(r["cost"] for r in records if r["phase"] == "H")
    tail = sum(r["cost"] for r in records if r["phase"] == "tail")
    return Episode.model_validate({**episode.model_dump(), "episode_id": "branch", "controller": name,
                                   "records": records, "controlled_cost": h, "tail_cost": tail, "total_cost": h + tail})


def infer(config: Config, state: State, release: dict, horizon: int = 48, tail: int = 16) -> dict:
    """Only server-registered checkpoint releases; CPU, greedy, weights_only loading."""
    import torch
    if torch.__version__.split('+')[0] != release["torch_version"]:
        raise ValueError("checkpoint Torch runtime mismatch")
    if (horizon,tail) != (release["horizon"], release["tail"]):
        raise ValueError("checkpoint horizon/tail mismatch")
    modules()
    learner = importlib.import_module("ht_pdm_fjsp.jcst_learner_v1")
    path = Path(release["path"])
    if hashlib.sha256(path.read_bytes()).hexdigest() != release["sha256"]:
        raise ValueError("checkpoint hash mismatch")
    config_hash = hashlib.sha256(json.dumps(config.model_dump(), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if release["config_hash"] != config_hash or release["source_commit"] != source_manifest()["commit"]:
        raise ValueError("checkpoint config/source mismatch")
    if release["arm"] not in ("S", "F", "A"):
        raise ValueError("invalid checkpoint arm")
    torch.set_num_threads(1)
    cfg = raw_config(config)
    universe = learner.action_universe(cfg)
    ordering_hash = hashlib.sha256(json.dumps(universe, separators=(",", ":")).encode()).hexdigest()
    if release["catalogue_hash"] != ordering_hash:
        raise ValueError("checkpoint catalogue ordering mismatch")
    policy = learner.Policy(release["arm"], cfg, universe)
    policy.load_state_dict(torch.load(path, map_location="cpu", weights_only=True), strict=True)
    policy.eval()
    encoded = learner.encode(cfg, raw_state(cfg, state), universe, horizon, tail)
    with torch.no_grad():
        choice = learner.choose(policy, encoded, deterministic=True)
    # Upstream choose returns (action index, log probability, value).
    action = universe[int(choice[0])]
    physics, _ = modules()
    physics.canonical_action(cfg, raw_state(cfg, state), action)
    return {"action": action, "arm": release["arm"], "mode": "greedy", "checkpoint_sha256": release["sha256"],
            "source_commit": release["source_commit"], "catalogue_hash": ordering_hash}
