"""Read-only readiness probe; not a Scenario implementation or acceptance gate.

Outputs explicit expected/observed verdicts for canonical test data. Never masks
a failed invariant as a passed test. No database or network access is performed.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from domain.operations.contracts import CandidatePlan, FactorySnapshot, RunDecisionCaseRequest
from domain.operations.service import DecisionPlanningService
from domain.operations.validator import OperationsValidatorV1


def main():
    root = Path(__file__).resolve().parents[1]
    request = RunDecisionCaseRequest.model_validate_json(
        (root / "tests/fixtures/scenario-maintenance-90-minute-slot.json").read_text()
    )
    candidate = DecisionPlanningService().plan(request).candidate_plans[0]
    results = []
    profile = "scenario-strict:1" if "--strict" in sys.argv else "legacy-v1"

    def probe(name, snapshot, plan):
        # Round-trip through canonical models: these are schema-valid candidates,
        # not model_construct bypasses or malformed JSON.
        canonical_snapshot = FactorySnapshot.model_validate(snapshot)
        canonical_plan = CandidatePlan.model_validate(plan)
        verdict = OperationsValidatorV1(constraint_profile=profile).validate(canonical_snapshot, canonical_plan)
        results.append({"probe": name, "expected": "INVALID", "actual": verdict.verdict.value,
                        "invariant_enforced": verdict.verdict.value == "INVALID",
                        "constraint_codes": [v.constraint_code for v in verdict.violations]})

    snapshot = request.factory_snapshot.model_dump(mode="json")
    plan = candidate.model_dump(mode="json")
    plan["schedule"]["assignments"] = []
    probe("mandatory_maintenance_omitted", snapshot, plan)

    plan = candidate.model_dump(mode="json")
    plan["schedule"]["assignments"][0]["end_at"] = "2026-10-27T00:01:00Z"
    probe("maintenance_duration_shortened_from_60_to_1", snapshot, plan)

    snapshot = request.factory_snapshot.model_dump(mode="json")
    snapshot["maintenance_requests"][0]["earliest_start_at"] = "2026-10-27T00:31:00Z"
    probe("maintenance_scheduled_before_deferred_lower_bound", snapshot, candidate.model_dump(mode="json"))

    snapshot = request.factory_snapshot.model_dump(mode="json")
    snapshot["current_schedule"] = candidate.schedule.model_dump(mode="json")
    snapshot["current_schedule"]["assignments"][0]["locked"] = True
    plan = candidate.model_dump(mode="json")
    plan["schedule"]["assignments"] = []
    probe("locked_assignment_omitted", snapshot, plan)

    raw = request.model_dump(mode="json")
    raw["factory_snapshot"]["maintenance_requests"] = []
    raw["factory_snapshot"]["jobs"] = [{
        "job_id": "J1", "display_name": "Golden blocked job", "release_at": "2026-10-27T00:00:00Z",
        "due_at": "2026-10-27T02:00:00Z", "priority": 50,
        "operations": [{"operation_id": "O1", "sequence": 0, "operation_type": "turning",
                        "status": "BLOCKED", "predecessor_operation_ids": [],
                        "machine_options": [{"machine_id": "M1", "processing_minutes": 30}]}],
    }]
    blocked_request = RunDecisionCaseRequest.model_validate(raw)
    blocked_plan = DecisionPlanningService().plan(blocked_request).candidate_plans[0]
    probe("blocked_production_operation_scheduled", blocked_request.factory_snapshot.model_dump(mode="json"),
          blocked_plan.model_dump(mode="json"))
    print(json.dumps({"kind": "readiness_probe_not_acceptance", "constraint_profile": profile, "probes": results,
                      "all_invariants_enforced": all(r["invariant_enforced"] for r in results)}, indent=2))
    if "--fail-on-gap" in sys.argv and not all(r["invariant_enforced"] for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
