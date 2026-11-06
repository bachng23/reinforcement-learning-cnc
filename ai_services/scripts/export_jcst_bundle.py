"""Export engineering fixtures or a bounded, read-only projection of an existing SE1 run.

No collection, training, TEST access or checkpoint inference is performed.
"""
from __future__ import annotations
from dataclasses import asdict
import argparse
import csv
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain.jcst.contracts import Bundle, Episode
from domain.jcst.runtime import SOURCE, audit_episode, generate_episode, modules, raw_config, source_manifest


def artifact(key, content, media="application/json"):
    return dict(artifact_id=key, content=content, media_type=media,
                sha256=hashlib.sha256(content.encode()).hexdigest())


def provenance(protocol_id, protocol_bytes):
    manifest = source_manifest()
    return dict(repository=manifest["repository"], commit=manifest["commit"],
                source_hash=hashlib.sha256((SOURCE / "manifest.json").read_bytes()).hexdigest(),
                protocol_id=protocol_id, protocol_hash=hashlib.sha256(protocol_bytes).hexdigest())


def engineering_bundle():
    text = "Bounded JCST/1.1 engineering integration fixture. Not scientific performance evidence.\n"
    episode = generate_episode()
    audit_episode(episode)
    return Bundle(campaign_key="jcst-engineering", title="JCST engineering verification",
                  objective="Verify import, physical replay and copied-state decisions on a new engineering seed.",
                  study_key="engineering", run_key="threshold5-990000001", origin="engineering",
                  provenance=provenance("engineering-integration-v1", text.encode()),
                  artifacts=[artifact("engineering-protocol", text, "text/markdown")], episodes=[episode],
                  claims=["Included trace passed independent physical replay."],
                  limitations=["One engineering episode; no scientific performance estimate or learning claim."])


def se1_bundle(source_repo: Path, run: Path, analysis: Path, physical_audit: Path, stats_audit: Path):
    # All inputs are explicit files in an existing, completed run. Never glob seed banks or TEST.
    run = run.resolve()
    for p in (analysis, physical_audit, stats_audit):
        p.resolve().relative_to(run)
    report = json.loads(analysis.read_text())
    manifest = json.loads((run / "manifest.json").read_text())
    if manifest.get("status") != "COLLECTED" or manifest.get("smoke") is not False or manifest.get("failure") is not None:
        raise ValueError("SE1 manifest must be complete")
    for entry in source_manifest()["files"].values():
        if entry["source_path"].startswith("src/") and manifest.get("source_hashes", {}).get(entry["source_path"]) != entry["sha256"]:
            raise ValueError("collected physics/actor differs from pinned runtime source")
    if manifest["protocol_hash"] != hashlib.sha256((source_repo / "docs/jcst_sample_efficiency_protocol_se1.md").read_bytes()).hexdigest():
        raise ValueError("source protocol differs from collected campaign")
    if report.get("audit_report_sha256") != hashlib.sha256(physical_audit.read_bytes()).hexdigest():
        raise ValueError("analysis does not reference the supplied physical audit")
    statistical = json.loads(stats_audit.read_text())
    if statistical.get("analysis_report_sha256") != hashlib.sha256(analysis.read_bytes()).hexdigest():
        raise ValueError("statistics audit does not reference the supplied analysis")
    manifest_hash = hashlib.sha256((run / "manifest.json").read_bytes()).hexdigest()
    if statistical.get("run_manifest_sha256") != manifest_hash or json.loads(physical_audit.read_text()).get("source_manifest_sha256") != manifest_hash:
        raise ValueError("audit reports refer to a different collected manifest")
    protocol = (source_repo / "docs/jcst_sample_efficiency_protocol_se1.md").read_bytes()
    table = analysis.parent / "root_checkpoint.csv"
    curves = []
    with table.open() as handle:
        for row in csv.DictReader(handle):
            curves.append(dict(case_id=row["case"], arm=row["arm"], training_root=row["root"], samples=int(row["checkpoint"]),
                mode="greedy", mean_total_cost=float(row["mean_cost"]), mean_h_cost=float(row["mean_H_cost"]),
                mean_tail_cost=float(row["mean_tail_cost"]), training_seconds=float(row["training_seconds"])))
    contrasts = []
    for case, result in report["primary"].items():
        for name, value in result["contrasts"].items():
            contrasts.append(dict(case_id=case, contrast=name, estimand="Normalized H+tail area over 24k–384k log-sample learning curve",
                difference=value["mean_difference"], interval=value["adjusted_interval"],
                interval_method="99.1667% Bonferroni-adjusted crossed-bootstrap; six-contrast family",
                gate="PASS" if value["practical_pass"] else "FAIL"))
    projection = json.dumps(dict(format="jcst-analysis-projection/1.0", curves=curves, contrasts=contrasts,
                                source_artifact_ids=["se1-analysis", "se1-root-table"]), ensure_ascii=False)
    artifacts = [artifact("se1-manifest", (run / "manifest.json").read_text()),
                 artifact("se1-analysis", analysis.read_text()), artifact("se1-root-table", table.read_text(), "text/csv"),
                 artifact("physical-audit", physical_audit.read_text()), artifact("statistical-audit", stats_audit.read_text()),
                 artifact("se1-protocol", protocol.decode(), "text/markdown"), artifact("analysis-projection", projection)]
    # Fixed documentary subset: root 0, 96k, greedy, first recorded episode, each arm/case.
    # State reconstruction follows recorded actions; original row and provenance are retained.
    physics, _ = modules(); episodes = []; raw_rows = []
    for case in ("base", "generalist"):
        from dataclasses import replace
        cfg = physics.engineering_config()
        if case == "generalist": cfg = replace(cfg, duration=tuple(((2,8,5),(8,2,5)) for _ in range(3)))
        for arm in ("S", "A", "F"):
            path = run / f"evaluations/eval/{case}/{arm}/0/checkpoint-96000-greedy.jsonl"
            with path.open() as handle: raw = json.loads(next(handle))
            if raw["terminal_status"] != "COMPLETE": raise ValueError("incomplete source episode")
            state = physics.initial_state(cfg); records = []
            for old in raw["trace"]:
                action = tuple(tuple(e) for e in old["action"])
                result = physics.transition(cfg, state, action, raw["seed"])
                if result.cost != old["cost"] or result.breakdown != old["breakdown"]:
                    raise ValueError("source trace does not match pinned physics")
                records.append(dict(tick=old["tick"], phase=old["phase"], before=asdict(state), action=action,
                    catalogue=physics.legal_actions(cfg,state), after=asdict(result.state), cost=result.cost,
                    breakdown=result.breakdown, events=result.events))
                state = result.state
            if json.loads(json.dumps(asdict(state))) != raw["final_state"]: raise ValueError("source final-state mismatch")
            e = Episode(episode_id=f"se1-{case}-{arm}-root0-96k-physical0", case_id=case, controller=arm,
                physical_seed=str(raw["seed"]), seed_role="evaluation", training_root="0", checkpoint_samples=96000,
                horizon=48, tail=16, config=asdict(cfg), records=records, controlled_cost=raw["H_cost"],
                tail_cost=raw["tail_cost"], total_cost=raw["total_cost"])
            audit_episode(e); episodes.append(e); raw_rows.append(raw)
    artifacts.append(artifact("selected-source-episodes", json.dumps(raw_rows)))
    return Bundle(campaign_key="jcst-sample-efficiency", title="JCST SE1 sample efficiency",
        objective="Compare structured S/A and flat F over the prelocked 24k–384k decision window in base and generalist.",
        study_key="SE1", run_key=run.name, origin="research", provenance=provenance("JCST-SE1",protocol),
        artifacts=artifacts, analysis_artifact_id="analysis-projection", curves=curves, contrasts=contrasts, episodes=episodes,
        source_audits=[dict(kind="physical",status="PASS",artifact_id="physical-audit",scope="Source campaign replay report; only six included traces replayed locally on import"),
                       dict(kind="statistical",status="PASS",artifact_id="statistical-audit",scope="Source raw-row statistics audit; not rerun by the platform")],
        claims=["S and A pass the two-case prelocked sample-efficiency area gates against F."],
        limitations=["S−A cross-message benefit remains unproven; no equivalence claim.",
                     "Sample efficiency is distinct from matched-wall-time performance or industrial validity.",
                     "Trace coverage: fixed root-0/96k/first-episode subset; source analysis retains all roots."])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--se1-run", type=Path)
    parser.add_argument("--source-repo", type=Path)
    parser.add_argument("--analysis", type=Path)
    parser.add_argument("--physical-audit", type=Path)
    parser.add_argument("--stats-audit", type=Path)
    args = parser.parse_args()
    if args.se1_run and not all((args.source_repo,args.analysis,args.physical_audit,args.stats_audit)):
        parser.error("SE1 export requires explicit source repo, analysis and audit paths")
    bundle = se1_bundle(args.source_repo,args.se1_run,args.analysis,args.physical_audit,args.stats_audit) if args.se1_run else engineering_bundle()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as handle:
        handle.write(bundle.model_dump_json(exclude_none=True, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "episodes": len(bundle.episodes), "curves": len(bundle.curves)}))
