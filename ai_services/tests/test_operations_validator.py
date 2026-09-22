import json
from pathlib import Path

import pytest

from domain.operations.contracts import (
    CandidatePlan,
    PlanValidation,
    RunDecisionCaseRequest,
    ValidationVerdict,
)
from domain.operations.validator import OperationsValidatorV1


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPOSITORY_ROOT / "contracts" / "v3" / "fixtures"
INVALID_DIR = FIXTURE_DIR / "invalid"
EXAMPLE_PATH = REPOSITORY_ROOT / "contracts" / "v3" / "examples" / "demo-scenario.json"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def canonical_request() -> RunDecisionCaseRequest:
    return RunDecisionCaseRequest.model_validate(
        _load_json(FIXTURE_DIR / "demo-health-alert.json")
    )


@pytest.fixture(scope="module")
def canonical_candidates() -> list[CandidatePlan]:
    payload = _load_json(EXAMPLE_PATH)
    return [CandidatePlan.model_validate(item) for item in payload["candidate_plans"]]


def test_canonical_demo_candidates_are_valid(
    canonical_request: RunDecisionCaseRequest,
    canonical_candidates: list[CandidatePlan],
) -> None:
    validator = OperationsValidatorV1()

    for candidate in canonical_candidates:
        result = validator.validate(
            canonical_request.factory_snapshot,
            candidate,
            seed=canonical_request.planning_config.base_seed,
        )

        assert result.verdict is ValidationVerdict.VALID
        assert result.violations == []
        assert result.candidate_plan_id == candidate.candidate_plan_id
        assert result.validator_version == "operations-validator-v1"
        assert PlanValidation.model_validate(result.model_dump()) == result


def test_embedded_fixture_verdict_is_not_used(
    canonical_request: RunDecisionCaseRequest,
    canonical_candidates: list[CandidatePlan],
) -> None:
    candidate_with_hardcoded_verdict = canonical_candidates[0]
    candidate_without_verdict = candidate_with_hardcoded_verdict.model_copy(
        update={"validation": None}
    )
    validator = OperationsValidatorV1()

    with_verdict = validator.validate(
        canonical_request.factory_snapshot,
        candidate_with_hardcoded_verdict,
        seed=17,
    )
    without_verdict = validator.validate(
        canonical_request.factory_snapshot,
        candidate_without_verdict,
        seed=17,
    )

    assert with_verdict == without_verdict
    assert with_verdict.verdict is ValidationVerdict.VALID


def test_same_input_and_seed_produce_identical_output(
    canonical_request: RunDecisionCaseRequest,
    canonical_candidates: list[CandidatePlan],
) -> None:
    validator = OperationsValidatorV1()
    candidate = canonical_candidates[1]

    first = validator.validate(
        canonical_request.factory_snapshot,
        candidate,
        seed=canonical_request.planning_config.base_seed,
    )
    second = validator.validate(
        canonical_request.factory_snapshot,
        candidate,
        seed=canonical_request.planning_config.base_seed,
    )

    assert first == second
    assert first.model_dump_json() == second.model_dump_json()


@pytest.mark.parametrize(
    ("fixture_name", "expected_code"),
    [
        ("machine-capacity-overlap.json", "MACHINE_CAPACITY_OVERLAP"),
        ("candidate-machine-ineligible.json", "MACHINE_ELIGIBILITY"),
        ("candidate-outside-snapshot-window.json", "PLANNING_WINDOW"),
        ("candidate-precedence-violation.json", "PRECEDENCE"),
        ("candidate-unknown-resource.json", "UNKNOWN_RESOURCE_REFERENCE"),
        ("candidate-technician-unavailable.json", "TECHNICIAN_AVAILABILITY"),
        (
            "candidate-technician-skill-inadequate.json",
            "TECHNICIAN_SKILL_ADEQUACY",
        ),
    ],
)
def test_invalid_candidate_fixtures_return_clear_violations(
    fixture_name: str,
    expected_code: str,
    canonical_request: RunDecisionCaseRequest,
) -> None:
    candidate = CandidatePlan.model_validate(_load_json(INVALID_DIR / fixture_name))

    result = OperationsValidatorV1().validate(
        canonical_request.factory_snapshot,
        candidate,
        seed=canonical_request.planning_config.base_seed,
    )

    matching = [
        violation
        for violation in result.violations
        if violation.constraint_code == expected_code
    ]
    assert result.verdict is ValidationVerdict.INVALID
    assert matching
    assert all(violation.message and violation.entity_refs for violation in matching)


def test_overlap_fixture_is_evaluated_without_embedded_verdict(
    canonical_request: RunDecisionCaseRequest,
) -> None:
    candidate = CandidatePlan.model_validate(
        _load_json(INVALID_DIR / "machine-capacity-overlap.json")
    )
    without_embedded_verdict = candidate.model_copy(update={"validation": None})
    validator = OperationsValidatorV1()

    original_result = validator.validate(
        canonical_request.factory_snapshot,
        candidate,
        seed=3,
    )
    copied_result = validator.validate(
        canonical_request.factory_snapshot,
        without_embedded_verdict,
        seed=3,
    )

    assert original_result == copied_result
    assert original_result.verdict is ValidationVerdict.INVALID
    assert "MACHINE_CAPACITY_OVERLAP" in {
        violation.constraint_code for violation in original_result.violations
    }
