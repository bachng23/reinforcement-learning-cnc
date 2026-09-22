"""Emit a deterministic, validated backend seed/reset plan; never connect to a DB."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai_services"))
from domain.operations.contracts import RunDecisionCaseRequest, DecisionCaseStatusResponse


def build_plan(action: str) -> dict:
    fixture_dir = ROOT / "contracts/v3/fixtures"
    request = RunDecisionCaseRequest.model_validate_json(
        (fixture_dir / "demo-health-alert.json").read_text(encoding="utf-8"))
    status = DecisionCaseStatusResponse.model_validate_json(
        (fixture_dir / "demo-case-status.json").read_text(encoding="utf-8"))
    snapshot = request.factory_snapshot
    assert status.decision_case_id == request.decision_case_id
    assert status.snapshot_id == snapshot.snapshot_id
    # Logical entities: Week 2's Prisma adapter maps these to actual tables.
    entities = [
        ("factory", [{"factory_id": snapshot.factory_id}], "factory_id"),
        ("machines", snapshot.machines, "machine_id"),
        ("technicians", snapshot.technicians, "technician_id"),
        ("jobs", snapshot.jobs, "job_id"),
        ("maintenance_requests", snapshot.maintenance_requests, "maintenance_request_id"),
        ("health_snapshots", snapshot.health_snapshots, "health_snapshot_id"),
        ("schedules", [snapshot.current_schedule] if snapshot.current_schedule else [], "schedule_id"),
        ("factory_snapshots", [snapshot], "snapshot_id"),
        ("decision_cases", [status], "decision_case_id"),
    ]
    steps = []
    for entity, records, key in entities:
        payloads = [record.model_dump(mode="json") if hasattr(record, "model_dump") else record for record in records]
        steps.append({"entity": entity, "key": key, "ids": [record[key] for record in payloads],
                      **({"records": payloads} if action == "seed" else {})})
    canonical = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return {
        "plan_version": 1, "scenario_id": "demo-health-alert", "action": action,
        "dry_run": True, "factory_id": snapshot.factory_id,
        "fixture_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
        "base_seed": request.planning_config.base_seed,
        "strategy": "transactional-upsert" if action == "seed" else "delete-demo-scope-in-reverse-dependency-order",
        "steps": steps if action == "seed" else list(reversed(steps)),
        "run_request": request.model_dump(mode="json") if action == "seed" else None,
        "adapter_requirements": [
            "Require an explicit development/demo database target and verify factory scope.",
            "Execute all steps in one transaction; upsert only these stable IDs.",
            "Treat nested capabilities, skills, operations and assignments as child records.",
            "On reset first delete events, traces, recommendations, decisions and new schedule revisions owned by this demo factory/case; never delete global users or tools.",
            "For immutable snapshots/schedules, compare content on ID conflict; require reset if different.",
            "Seed CREATED state only; starting AI execution is a separate explicit action.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["seed", "reset"], nargs="?", default="seed")
    args = parser.parse_args()
    print(json.dumps(build_plan(args.action), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
