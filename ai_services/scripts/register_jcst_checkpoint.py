"""Explicit operator registration of hash-verified S/F/A checkpoints; never trains."""
import argparse
from dataclasses import asdict, replace
import hashlib
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain.jcst.contracts import Config
from domain.jcst.runtime import modules, source_manifest

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--arm", choices=["S","F","A"], required=True)
    parser.add_argument("--case", choices=["base","generalist"], required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--registry", type=Path, required=True)
    args = parser.parse_args()
    if not __import__('re').fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", args.release_id): parser.error("invalid release ID")
    digest = hashlib.sha256(args.checkpoint.read_bytes()).hexdigest()
    if digest != args.expected_sha256: parser.error("checkpoint differs from expected source hash")
    physics, _ = modules(); cfg = physics.engineering_config()
    if args.case == "generalist": cfg = replace(cfg, duration=tuple(((2,8,5),(8,2,5)) for _ in range(3)))
    config = Config.model_validate(asdict(cfg)).model_dump()
    # action_universe equals the fully idle legal catalogue in the pinned learner.
    catalogue = physics.legal_actions(cfg,physics.initial_state(cfg))
    release = dict(arm=args.arm, case_id=args.case, sha256=digest, path=f"checkpoints/{digest}.pt",
                   config_hash=hashlib.sha256(json.dumps(config,sort_keys=True,separators=(",", ":")).encode()).hexdigest(),
                   catalogue_hash=hashlib.sha256(json.dumps(catalogue,separators=(",", ":")).encode()).hexdigest(),
                   source_commit=source_manifest()["commit"], torch_version="2.14.0", horizon=48, tail=16)
    registry = json.loads(args.registry.read_text()) if args.registry.exists() else {}
    if args.release_id in registry and registry[args.release_id] != release: parser.error("release identity conflict")
    target = args.registry.parent / release["path"]; target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != digest: parser.error("stored checkpoint is corrupt")
    if not target.exists(): shutil.copyfile(args.checkpoint,target)
    registry[args.release_id] = release
    temporary = args.registry.with_suffix('.tmp'); temporary.write_text(json.dumps(registry,indent=2)+'\n'); temporary.replace(args.registry)
    print(json.dumps({"release_id":args.release_id,"sha256":digest,"registry":str(args.registry)}))
