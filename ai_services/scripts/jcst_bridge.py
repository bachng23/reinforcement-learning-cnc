"""Bounded stdin/stdout process protocol for the Node research worker."""
from __future__ import annotations
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain.jcst.contracts import Bundle, Config, Episode, State
from domain.jcst.runtime import audit_episode, branch_episode, controller, generate_episode, infer, modules, raw_config, raw_state, source_manifest


def execute(request: dict):
    operation = request["operation"]
    if operation.startswith("demo_"):
        from domain.jcst.demo import initialize, prepare, commit, autoplay, configure
        if operation == "demo_init":
            return initialize(**request["options"])
        if operation == "demo_configure":
            return configure(request["session"], request["primary"], request["baseline"], request["continuous"])
        if operation == "demo_prepare":
            return prepare(request["session"])
        if operation == "demo_autoplay":
            return autoplay(request["session"], request["stop_at"], request["max_ticks"])
        if operation == "demo_commit":
            return commit(request["session"], request["action"], request["actor"], request["reason"])
        raise ValueError("unsupported demo operation")
    if operation == "validate":
        bundle = Bundle.model_validate(request["bundle"])
        audits = [audit_episode(e) for e in bundle.episodes]
        return {"bundle": bundle.model_dump(mode="json", exclude_none=True), "physical_replay": audits}
    if operation == "generate":
        episode = generate_episode(**request.get("options", {}))
        return {"episode": episode.model_dump(mode="json", exclude_none=True), "audit": audit_episode(episode)}
    if operation == "branch":
        episode = Episode.model_validate(request["episode"])
        audit_episode(episode)
        cfg = raw_config(episode.config)
        _, controls = modules()
        state = raw_state(cfg, episode.records[request["tick"]].before)
        baseline_action = controller(request["controller"]).choose(controls.observe(cfg,state,episode.horizon,episode.tail)).action
        baseline = branch_episode(episode, request["tick"], list(baseline_action), request["controller"])
        result = branch_episode(episode, request["tick"], request["action"], request["controller"])
        return {"episode": result.model_dump(mode="json", exclude_none=True), "audit": audit_episode(result),
                "baseline": baseline.model_dump(mode="json", exclude_none=True), "baseline_audit": audit_episode(baseline)}
    if operation == "infer":
        registry = Path(os.environ["JCST_RELEASE_REGISTRY"])
        releases = json.loads(registry.read_text())
        release = releases[request["release_id"]]
        release["path"] = str(registry.parent / release["path"])
        return infer(Config.model_validate(request["config"]), State.model_validate(request["state"]), release, request["horizon"], request["tail"])
    if operation == "capabilities":
        import importlib.util
        learned = []
        registry_path = os.environ.get("JCST_RELEASE_REGISTRY")
        torch_available = importlib.util.find_spec("torch") is not None
        if registry_path and Path(registry_path).is_file():
            for key, release in json.loads(Path(registry_path).read_text()).items():
                path = Path(registry_path).parent / release["path"]
                learned.append({"release_id": key, "arm": release["arm"], "case_id": release["case_id"],
                                "available": torch_available and path.is_file()})
        return {"simulator_version": "JCST/1.1", "source": source_manifest(),
                "controls": ["threshold5", "risk", "corrective", "wait"], "training": False,
                "learned_inference": any(r["available"] for r in learned), "learned_releases": learned}
    raise ValueError("unsupported bridge operation")


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read(8_000_001))
        print(json.dumps(execute(request), allow_nan=False))
    except Exception as exc:
        # Paths, tensor internals and raw input never become public errors.
        print(json.dumps({"error": "JCST_VALIDATION_FAILED", "details": str(exc)[:500]}))
        sys.exit(1)
