from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path

AI_SERVICES_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICES_ROOT))

from domain.operations.demo import (
    DEMO_CANDIDATE_PLANS,
    DEMO_FACTORY_SNAPSHOT,
    DEMO_PLAN_VALIDATIONS,
    DEMO_PLANNING_CONFIG,
    DEMO_TRIGGER,
)


REPOSITORY_ROOT = AI_SERVICES_ROOT.parent
EXAMPLE_PATH = REPOSITORY_ROOT / "contracts" / "v3" / "examples" / "demo-scenario.json"
INVALID_DIR = REPOSITORY_ROOT / "contracts" / "v3" / "fixtures" / "invalid"


def _dump(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _json(model: object) -> dict:
    return model.model_dump(mode="json")  # type: ignore[attr-defined, no-any-return]


def main() -> None:
    snapshot = _json(DEMO_FACTORY_SNAPSHOT)
    candidates = [_json(plan) for plan in DEMO_CANDIDATE_PLANS]
    validations = [_json(validation) for validation in DEMO_PLAN_VALIDATIONS]

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
    print(INVALID_DIR)


if __name__ == "__main__":
    main()
