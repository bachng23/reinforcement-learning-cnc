from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path

AI_SERVICES_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICES_ROOT))

from domain.operations.demo import (
    DEMO_CASE_STATUS,
    DEMO_CANDIDATE_PLANS,
    DEMO_FACTORY_SNAPSHOT,
    DEMO_PLAN_VALIDATIONS,
    DEMO_PLANNING_CONFIG,
    DEMO_RUN_REQUEST,
    DEMO_TRIGGER,
)


REPOSITORY_ROOT = AI_SERVICES_ROOT.parent
EXAMPLE_PATH = REPOSITORY_ROOT / "contracts" / "v3" / "examples" / "demo-scenario.json"
FIXTURE_DIR = REPOSITORY_ROOT / "contracts" / "v3" / "fixtures"
RUN_REQUEST_PATH = FIXTURE_DIR / "demo-health-alert.json"
CASE_STATUS_PATH = FIXTURE_DIR / "demo-case-status.json"
INVALID_DIR = REPOSITORY_ROOT / "contracts" / "v3" / "fixtures" / "invalid"


def _dump(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _json(model: object) -> dict:
    return model.model_dump(mode="json")  # type: ignore[attr-defined, no-any-return]


def _assignment(candidate: dict, assignment_id: str) -> dict:
    return next(
        assignment
        for assignment in candidate["schedule"]["assignments"]
        if assignment["assignment_id"] == assignment_id
    )


def _candidate_fixture(candidates: list[dict], suffix: str) -> dict:
    candidate = deepcopy(candidates[0])
    candidate["candidate_plan_id"] = f"plan-invalid-{suffix}"
    candidate["schedule"]["schedule_id"] = f"schedule-invalid-{suffix}"
    candidate["validation"] = None
    return candidate


def main() -> None:
    snapshot = _json(DEMO_FACTORY_SNAPSHOT)
    candidates = [_json(plan) for plan in DEMO_CANDIDATE_PLANS]
    validations = [_json(validation) for validation in DEMO_PLAN_VALIDATIONS]

    _dump(RUN_REQUEST_PATH, _json(DEMO_RUN_REQUEST))
    _dump(CASE_STATUS_PATH, _json(DEMO_CASE_STATUS))

    _dump(
        EXAMPLE_PATH,
        {
            "factory_snapshot": snapshot,
            "trigger": _json(DEMO_TRIGGER),
            "planning_config": _json(DEMO_PLANNING_CONFIG),
            "candidate_plans": candidates,
            "validations": validations,
        },
    )

    unknown_machine = deepcopy(snapshot)
    unknown_machine["jobs"][0]["operations"][0]["machine_options"][0][
        "machine_id"
    ] = "M99"
    _dump(INVALID_DIR / "unknown-machine-option.json", unknown_machine)

    outside_window = deepcopy(candidates[0]["schedule"])
    outside_window["assignments"][0]["start_at"] = "2026-09-21T23:30:00Z"
    _dump(INVALID_DIR / "assignment-outside-planning-window.json", outside_window)

    overlap_candidate = deepcopy(candidates[0])
    overlap_candidate["candidate_plan_id"] = "plan-invalid-machine-overlap"
    overlap_candidate["schedule"]["schedule_id"] = "schedule-invalid-machine-overlap"
    same_machine = overlap_candidate["schedule"]["assignments"][0]
    conflicting = overlap_candidate["schedule"]["assignments"][2]
    conflicting["machine_id"] = same_machine["machine_id"]
    conflicting["start_at"] = same_machine["start_at"]
    conflicting["end_at"] = same_machine["end_at"]
    overlap_candidate["validation"] = {
        "schema_version": "3.0",
        "validation_id": "validation-invalid-machine-overlap",
        "candidate_plan_id": "plan-invalid-machine-overlap",
        "validator_version": "hard-constraints-v1",
        "verdict": "INVALID",
        "validated_at": "2026-09-22T00:02:00Z",
        "violations": [
            {
                "violation_id": "violation-machine-overlap-001",
                "constraint_code": "MACHINE_CAPACITY_OVERLAP",
                "severity": "ERROR",
                "message": "Two production assignments overlap on M01.",
                "entity_refs": [
                    same_machine["assignment_id"],
                    conflicting["assignment_id"],
                    "M01",
                ],
                "time_window": {
                    "start_at": same_machine["start_at"],
                    "end_at": same_machine["end_at"],
                },
            }
        ],
        "simulation_runs": 0,
        "warnings": [],
    }
    _dump(INVALID_DIR / "machine-capacity-overlap.json", overlap_candidate)

    ineligible_machine = _candidate_fixture(candidates, "machine-eligibility")
    _assignment(ineligible_machine, "A-J01-O10")["machine_id"] = "M03"
    _dump(INVALID_DIR / "candidate-machine-ineligible.json", ineligible_machine)

    unknown_resource = _candidate_fixture(candidates, "unknown-resource")
    _assignment(unknown_resource, "A-J01-O10")["machine_id"] = "M99"
    _dump(INVALID_DIR / "candidate-unknown-resource.json", unknown_resource)

    outside_snapshot_window = _candidate_fixture(candidates, "planning-window")
    outside_snapshot_window["schedule"]["planning_window"][
        "start_at"
    ] = "2026-09-21T23:00:00Z"
    first_assignment = _assignment(outside_snapshot_window, "A-J01-O10")
    first_assignment["start_at"] = "2026-09-21T23:00:00Z"
    first_assignment["end_at"] = "2026-09-22T00:00:00Z"
    _dump(
        INVALID_DIR / "candidate-outside-snapshot-window.json",
        outside_snapshot_window,
    )

    precedence = _candidate_fixture(candidates, "precedence")
    successor = _assignment(precedence, "A-J01-O20")
    successor["start_at"] = "2026-09-22T00:00:00Z"
    successor["end_at"] = "2026-09-22T00:30:00Z"
    _dump(INVALID_DIR / "candidate-precedence-violation.json", precedence)

    unavailable_technician = _candidate_fixture(
        candidates, "technician-availability"
    )
    maintenance = _assignment(
        unavailable_technician, "A-maintenance-plan-production-priority"
    )
    maintenance["technician_ids"] = ["T02"]
    maintenance["start_at"] = "2026-09-22T00:00:00Z"
    maintenance["end_at"] = "2026-09-22T01:00:00Z"
    _dump(
        INVALID_DIR / "candidate-technician-unavailable.json",
        unavailable_technician,
    )

    inadequate_skill = _candidate_fixture(candidates, "technician-skill")
    _assignment(inadequate_skill, "A-maintenance-plan-production-priority")[
        "technician_ids"
    ] = ["T03"]
    _dump(
        INVALID_DIR / "candidate-technician-skill-inadequate.json",
        inadequate_skill,
    )

    invalid_without_error = deepcopy(validations[0])
    invalid_without_error["validation_id"] = "validation-invalid-without-error"
    invalid_without_error["verdict"] = "INVALID"
    invalid_without_error["violations"] = []
    _dump(INVALID_DIR / "invalid-verdict-without-error.json", invalid_without_error)

    non_valid_plan = deepcopy(candidates[0])
    non_valid_plan["validation"] = deepcopy(overlap_candidate["validation"])
    non_valid_plan["validation"]["candidate_plan_id"] = non_valid_plan[
        "candidate_plan_id"
    ]
    recommendation = {
        "schema_version": "3.0",
        "recommendation_id": "recommendation-invalid-plan",
        "decision_case_id": "case-demo-M03-001",
        "snapshot_id": snapshot["snapshot_id"],
        "generated_at": "2026-09-22T00:03:00Z",
        "recommended_plan_id": non_valid_plan["candidate_plan_id"],
        "candidate_plans": [non_valid_plan],
        "explanation": {
            "summary": "This fixture must be rejected because its plan is INVALID.",
            "primary_reasons": ["Fixture for recommendation validation"],
            "tradeoffs": ["Not applicable"],
            "residual_risks": [],
            "evidence_refs": [non_valid_plan["validation"]["validation_id"]],
        },
    }
    _dump(INVALID_DIR / "recommendation-with-invalid-plan.json", recommendation)

    print(EXAMPLE_PATH)
    print(RUN_REQUEST_PATH)
    print(CASE_STATUS_PATH)
    print(INVALID_DIR)


if __name__ == "__main__":
    main()
