import json
import runpy
from pathlib import Path

import pytest
from pydantic import ValidationError
from domain.operations import contracts
from domain.operations.demo import DEMO_CASE_STATUS, DEMO_RUN_REQUEST

FIXTURES = Path(__file__).resolve().parents[2] / "contracts/v3/fixtures"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("entry", MANIFEST["fixtures"], ids=lambda entry: entry["file"])
def test_shared_fixture(entry):
    model = getattr(contracts, entry["model"])
    model.model_validate_json((FIXTURES / entry["file"]).read_text(encoding="utf-8"))


def test_demo_references_and_rejects_unknown_machine():
    request = contracts.RunDecisionCaseRequest.model_validate_json(
        (FIXTURES / "demo-health-alert.json").read_text(encoding="utf-8"))
    status = contracts.DecisionCaseStatusResponse.model_validate_json(
        (FIXTURES / "demo-case-status.json").read_text(encoding="utf-8"))
    assert status.decision_case_id == request.decision_case_id
    assert status.snapshot_id == request.factory_snapshot.snapshot_id
    assert status.mode == request.mode
    payload = request.model_dump(mode="json")
    payload["factory_snapshot"]["jobs"][0]["operations"][0]["machine_options"][0]["machine_id"] = "missing"
    with pytest.raises(ValidationError, match="unknown machines"):
        contracts.RunDecisionCaseRequest.model_validate(payload)


def test_shared_demo_fixtures_match_canonical_demo_models():
    request = json.loads((FIXTURES / "demo-health-alert.json").read_text(encoding="utf-8"))
    status = json.loads((FIXTURES / "demo-case-status.json").read_text(encoding="utf-8"))
    assert request == DEMO_RUN_REQUEST.model_dump(mode="json")
    assert status == DEMO_CASE_STATUS.model_dump(mode="json")
    assert len(request["factory_snapshot"]["machines"]) == 6
    assert len(request["factory_snapshot"]["jobs"]) == 12
    assert len(request["factory_snapshot"]["technicians"]) == 3


def test_seed_reset_plan_is_deterministic_and_scoped():
    build_plan = runpy.run_path(str(FIXTURES.parents[2] / "scripts/demo-seed-plan.py"))["build_plan"]
    seed = build_plan("seed")
    reset = build_plan("reset")
    assert seed == build_plan("seed")
    assert seed["dry_run"] is True
    assert seed["base_seed"] == DEMO_RUN_REQUEST.planning_config.base_seed
    assert seed["fixture_sha256"] == reset["fixture_sha256"]
    assert [step["entity"] for step in reset["steps"]] == [step["entity"] for step in reversed(seed["steps"])]
    for step in seed["steps"]:
        assert step["ids"]
        assert [row[step["key"]] for row in step["records"]] == step["ids"]
    assert all("records" not in step for step in reset["steps"])
    contracts.RunDecisionCaseRequest.model_validate(seed["run_request"])
