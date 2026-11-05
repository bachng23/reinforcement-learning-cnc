"""Real point evaluation with controlled monotonic deadline exhaustion after point one."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'ai_services'))
from domain.scenarios.contracts import SensitivityRequest
from domain.scenarios.evaluation import ScenarioEvaluator
from domain.scenarios.sensitivity import SensitivityEvaluator
import domain.scenarios.sensitivity as sensitivity

request = SensitivityRequest.model_validate(json.load(sys.stdin))
clock = [1000.0]
original = ScenarioEvaluator.plan

def completed_then_expired(self, *args):
    result = original(self, *args)
    clock[0] += request.input.budget.remaining_ms / 1000 + 1
    return result

ScenarioEvaluator.plan = completed_then_expired
sensitivity.time.monotonic = lambda: clock[0]
print(SensitivityEvaluator().evaluate(request).model_dump_json())
