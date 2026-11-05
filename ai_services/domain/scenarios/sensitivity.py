"""Bounded physical replanning and weight-only fixed-candidate reranking."""
import time

from domain.operations.contracts import ObjectiveWeights
from domain.operations.scoring import ObjectiveScorer
from domain.operations.validator import OperationsValidatorV1
from domain.scenarios.contracts import (
    Diagnostic, DurationAxis, Evaluation, MaintenanceDuration, RankChangeInterval,
    SensitivityPoint, SensitivityRequest, SensitivityResult, STRICT_PROFILE, WeightAxis, override_key,
)
from domain.scenarios.evaluation import ScenarioCancelled, ScenarioEvaluator, compare, ranking, validate_saved_source
from domain.scenarios.hashing import content_hash, normalized
from domain.scenarios.sampling import CommonRandomDraws
from domain.scenarios.transform import transform


def selected_strategy(evaluation):
    return next((p.strategy.value for p in evaluation.candidates if p.candidate_plan_id == evaluation.selected_candidate_id), None)


class SensitivityEvaluator:
    def __init__(self, *, cancelled=lambda: False):
        self.evaluator = ScenarioEvaluator(cancelled=cancelled)

    def evaluate(self, request: SensitivityRequest):
        deadline = time.monotonic() + request.input.budget.remaining_ms / 1000
        self.evaluator.check_cancelled()
        source, original, axis = request.source_result, request.input, request.axis
        effective, draws = validate_saved_source(original, source)
        points = []
        weight_only = isinstance(axis, WeightAxis)
        baseline_value = getattr(original.planning_config.objective_weights, axis.weight) if weight_only else next(
            (o.expected_duration_minutes for o in original.overrides if isinstance(o, MaintenanceDuration) and o.maintenance_request_id == axis.maintenance_request_id),
            next((m.expected_duration_minutes for m in original.baseline.snapshot.maintenance_requests if m.maintenance_request_id == axis.maintenance_request_id), None))
        if baseline_value is None:
            raise ValueError("sweep target absent from pinned snapshot")
        if not weight_only:
            # Validate target/override policy before starting points. A malformed
            # command is a 422, not a fabricated per-point infrastructure failure.
            target = next(m for m in original.baseline.snapshot.maintenance_requests if m.maintenance_request_id == axis.maintenance_request_id)
            if target.status.value in {"COMPLETED", "CANCELLED"}:
                raise ValueError("terminal maintenance cannot be swept")
            if len(original.overrides) == 5 and not any(isinstance(o, MaintenanceDuration) and o.maintenance_request_id == axis.maintenance_request_id for o in original.overrides):
                raise ValueError("sweep would exceed five overrides")
        candidates = source.scenario.candidates
        reference = ObjectiveScorer().normalization_reference(candidates)
        if weight_only and source.scenario.outcome == "FEASIBLE":
            if not candidates or effective.snapshot is None or source.scenario.ranking is None:
                raise ValueError("feasible source must contain validated candidates and ranking")
            expected_ranking = ranking(candidates, original.planning_config.objective_weights)
            if expected_ranking != source.scenario.ranking:
                raise ValueError("source ranking/reference does not match candidates")
            for candidate in candidates:
                validation = OperationsValidatorV1(constraint_profile=STRICT_PROFILE).validate(effective.snapshot, candidate)
                if validation.verdict.value != "VALID":
                    raise ValueError("source candidate violates pinned effective constraints")
        for value in sorted(axis.values):
            self.evaluator.check_cancelled()
            point_input = original
            if weight_only:
                weights = ObjectiveWeights.model_validate({**original.planning_config.objective_weights.model_dump(), axis.weight: value})
                point_hash = content_hash({"source": source.semantic_input_hash, "weights": weights.model_dump(), "axis": axis.weight})
            else:
                overrides = [o for o in original.overrides if not (isinstance(o, MaintenanceDuration) and o.maintenance_request_id == axis.maintenance_request_id)]
                overrides.append(MaintenanceDuration(type="MAINTENANCE_DURATION", maintenance_request_id=axis.maintenance_request_id, expected_duration_minutes=value))
                overrides.sort(key=override_key)
                if len(overrides) > 5:
                    raise ValueError("sweep would exceed five overrides")
                point_input = original.model_copy(update={"overrides": overrides})
                point_hash = content_hash(normalized({"source": source.semantic_input_hash, "overrides": [o.model_dump() for o in overrides]}))
            if time.monotonic() >= deadline:
                evaluation = Evaluation(outcome="TIMEOUT", diagnostics=[Diagnostic(code="NOT_STARTED_BEFORE_DEADLINE", message="Job budget exhausted before this point")])
            elif weight_only:
                if source.scenario.outcome != "FEASIBLE":
                    evaluation = source.scenario.model_copy(deep=True)
                else:
                    evidence = ranking(candidates, weights, reference=reference)
                    evaluation = source.scenario.model_copy(deep=True, update={"ranking": evidence, "selected_candidate_id": evidence.rows[0].candidate_plan_id})
            else:
                try:
                    transformed = transform(point_input)
                    evaluation = Evaluation(outcome="NO_FEASIBLE_PLAN", diagnostics=transformed.diagnostics) if transformed.snapshot is None else self.evaluator.plan(point_input, transformed.snapshot, draws, deadline)
                except ScenarioCancelled:
                    raise
                except Exception:
                    evaluation = Evaluation(outcome="FAILED", diagnostics=[Diagnostic(code="ENGINE_FAILURE", message="Physical point evaluation failed")])
            points.append(SensitivityPoint(value=value, input_hash=point_hash, status=evaluation.outcome,
                evaluation=evaluation, comparison=compare(source.baseline, evaluation)))
        intervals = []
        for left, right in zip(points, points[1:]):
            if left.status == right.status == "FEASIBLE":
                a, b = selected_strategy(left.evaluation), selected_strategy(right.evaluation)
                if a != b:
                    intervals.append(RankChangeInterval(lower_sample=left.value, upper_sample=right.value, from_strategy=a, to_strategy=b))
        completed = sum(p.status in {"FEASIBLE", "NO_FEASIBLE_PLAN"} for p in points)
        outcome = "COMPLETE" if completed == len(points) else "PARTIAL_FAILED" if completed else "FAILED"
        return SensitivityResult(identity=original.identity, outcome=outcome, axis=axis, requested_order=axis.values,
            baseline_value=baseline_value, baseline_point=source.scenario, points=points, rank_change_intervals=intervals,
            fixed_inputs=["pinned_baseline", "sampling", "engine_versions", "non_swept_overrides", "non_swept_weights"]
                + (["candidate_schedules", "raw_kpis", "normalization_reference"] if weight_only else []), sampling=source.sampling)
