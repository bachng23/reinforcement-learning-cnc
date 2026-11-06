"""Single bounded engine invocation, owned and terminated by the HTTP adapter."""
import json
import sys

from pydantic import ValidationError

from domain.scenarios.contracts import CompareRequest, EvaluationRequest, ScenarioInputError, SensitivityRequest
from domain.scenarios.comparison import compare_runs
from domain.scenarios.evaluation import ScenarioEvaluator
from domain.scenarios.sensitivity import SensitivityEvaluator


def main():
    if '--parent-pid' in sys.argv:
        from domain.scenarios.process_guard import watch_parent
        watch_parent(int(sys.argv[sys.argv.index('--parent-pid') + 1]))
    try:
        payload = json.load(sys.stdin)
        if payload.get("operation") == "EVALUATE":
            result = ScenarioEvaluator().evaluate(EvaluationRequest.model_validate(payload))
        elif payload.get("operation") == "SENSITIVITY":
            result = SensitivityEvaluator().evaluate(SensitivityRequest.model_validate(payload))
        elif payload.get("operation") == "COMPARE":
            result = compare_runs(CompareRequest.model_validate(payload))
        else:
            raise ScenarioInputError("UNSUPPORTED_OPERATION", "Unsupported Scenario operation")
        print(result.model_dump_json())
    except (ScenarioInputError, ValidationError, ValueError) as error:
        print(json.dumps({"contract_version": "scenario-engine:1.0", "error": {
            "code": getattr(error, "code", "INVALID_SCENARIO_INPUT"),
            "message": str(error)[:1000] if isinstance(error, ScenarioInputError) else "Frozen input or source result failed validation",
            "retryable": False}}))
        raise SystemExit(2)
    except Exception:
        print(json.dumps({"contract_version": "scenario-engine:1.0", "error": {
            "code": "ENGINE_FAILURE", "message": "Scenario evaluation failed", "retryable": True}}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
