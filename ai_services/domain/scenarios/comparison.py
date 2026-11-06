"""Compare saved evaluations without re-planning or comparing relative scores."""
from domain.scenarios.contracts import CompareRequest, CompareResult, ComparedRun
from domain.scenarios.evaluation import compare, validate_saved_source
from domain.scenarios.transform import transform


def compare_runs(request: CompareRequest) -> CompareResult:
    for run in request.runs:
        validate_saved_source(run.input, run.result)
    first = request.runs[0]
    return CompareResult(reference_identity=first.input.identity,
        reference_semantic_input_hash=first.result.semantic_input_hash,
        reference_planning_config=first.input.planning_config,
        reference_overrides=first.input.overrides, reference_sampling=first.result.sampling,
        runs=[ComparedRun(identity=run.input.identity, semantic_input_hash=run.result.semantic_input_hash,
            planning_config=run.input.planning_config, overrides=run.input.overrides,
            sampling=run.result.sampling, comparison=compare(first.result.scenario, run.result.scenario))
            for run in request.runs[1:]])
