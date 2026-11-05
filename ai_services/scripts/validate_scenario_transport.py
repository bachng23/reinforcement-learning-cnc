"""Backend's bounded contract bridge. Never executes planning or writes application data."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain.scenarios.contracts import EvaluationRequest, EvaluationResult, SensitivityRequest, SensitivityResult, CompareRequest, CompareResult
from domain.scenarios.transform import transform
from domain.scenarios.evaluation import ranking, validate_saved_source
from domain.operations.validator import OperationsValidatorV1
from domain.scenarios.contracts import STRICT_PROFILE

MODELS = {'EVALUATE': (EvaluationRequest, EvaluationResult),
          'SENSITIVITY': (SensitivityRequest, SensitivityResult), 'COMPARE': (CompareRequest, CompareResult)}


def validate(envelope):
    raw = envelope['request']
    request_type, result_type = MODELS[raw['operation']]
    request = request_type.model_validate(raw)
    if 'result' not in envelope:
        return
    result = result_type.model_validate(envelope['result'])
    if raw['operation'] == 'COMPARE':
        if result.reference_identity != request.runs[0].input.identity:
            raise ValueError('comparison reference mismatch')
        if [run.identity for run in result.runs] != [run.input.identity for run in request.runs[1:]]:
            raise ValueError('comparison identities mismatch')
        return
    original = request.input if raw['operation'] == 'SENSITIVITY' else request
    if result.identity != original.identity:
        raise ValueError('engine result identity mismatch')
    if raw['operation'] == 'EVALUATE':
        effective, draws = validate_saved_source(original, result)
        for evaluated, snapshot in ((result.baseline, original.baseline.snapshot), (result.scenario, effective.snapshot)):
            if evaluated.outcome != 'FEASIBLE':
                continue
            if snapshot is None or evaluated.ranking != ranking(evaluated.candidates, original.planning_config.objective_weights):
                raise ValueError('engine ranking mismatch')
            for candidate in evaluated.candidates:
                if candidate.schedule.factory_id != snapshot.factory_id:
                    raise ValueError('candidate factory mismatch')
                if OperationsValidatorV1(constraint_profile=STRICT_PROFILE).validate(snapshot, candidate).verdict.value != 'VALID':
                    raise ValueError('candidate violates effective constraints')
    else:
        if result.axis != request.axis or result.requested_order != request.axis.values:
            raise ValueError('sensitivity axis mismatch')
        if [point.value for point in result.points] != sorted(request.axis.values):
            raise ValueError('sensitivity points mismatch')
        if any(point.status != point.evaluation.outcome for point in result.points):
            raise ValueError('sensitivity outcome mismatch')


if __name__ == '__main__':
    try:
        validate(json.load(sys.stdin))
        print('{"ok":true}')
    except Exception:
        print('{"ok":false}')
        sys.exit(2)
