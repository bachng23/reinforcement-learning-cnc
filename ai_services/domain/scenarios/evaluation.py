"""Actual constrained planning with immutable inputs and scoped stochastic draws."""
import time

from domain.operations.contracts import RunDecisionCaseRequest
from domain.operations.scoring import ObjectiveScorer
from domain.operations.service import DecisionPlanningService, NoFeasiblePlan, PlanningTimedOut
from domain.operations.simulator import DeterministicSimulator
from domain.scenarios.contracts import (
    CandidateAvailability, Comparison, DeferMaintenance, Diagnostic, Evaluation, EvaluationRequest,
    EvaluationResult, LiveMapping, MetricComparison, Ranking, RankingRow, STRICT_PROFILE,
)
from domain.scenarios.hashing import content_hash, normalized
from domain.scenarios.sampling import CommonRandomDraws
from domain.scenarios.transform import transform

STRATEGIES = {"production-priority": "PRODUCTION_PRIORITY", "balanced": "BALANCED", "reliability-priority": "RELIABILITY_PRIORITY"}
METRICS = {
    "makespan_minutes": ("minute", "LOWER"), "total_tardiness_minutes": ("minute", "LOWER"),
    "maximum_tardiness_minutes": ("minute", "LOWER"), "on_time_completion_rate": ("ratio", "HIGHER"),
    "expected_failure_count": ("expected_count", "LOWER"), "failure_probability": ("probability", "LOWER"),
    "expected_emergency_downtime_minutes": ("minute", "LOWER"), "maintenance_cost": ("model_cost_unit", "LOWER"),
    "technician_utilization": ("ratio", "LOWER"), "schedule_changes": ("count", "LOWER"),
    "decision_latency_ms": ("millisecond", "LOWER"),
}
ASSUMPTIONS = [
    "Uncalibrated simplified failure model; estimates are not sensor facts.",
    "Maintenance reduces model failure probability by 70%.",
    "Emergency downtime is capped by the candidate makespan and observation horizon.",
    "Technician utilization is minimized by the current workforce objective; it is not a general productivity verdict.",
    "Common random draws couple baseline, strategies and physical points; no rank-confidence probability is estimated.",
]


class ScenarioCancelled(Exception):
    pass


def semantic_input_hash(request, effective, draws):
    return content_hash(normalized({"engine": request.engine_version, "contract": request.contract_version,
        "validator": STRICT_PROFILE, "baseline": request.baseline.snapshot.model_dump(),
        "effective_hash": effective.effective_hash, "overrides": [o.model_dump() for o in effective.overrides],
        "config": request.planning_config.model_dump(), "sampling": draws.metadata()}))


def validate_saved_source(request, result):
    effective = transform(request)
    draws = CommonRandomDraws(request.baseline.snapshot, request.sampling)
    if result.effective != effective or result.sampling.model_dump() != draws.metadata():
        raise ValueError("saved result effective input/sampling mismatch")
    if result.semantic_input_hash != semantic_input_hash(request, effective, draws):
        raise ValueError("saved result semantic configuration mismatch")
    if result.identity != request.identity:
        raise ValueError("saved result identity mismatch")
    return effective, draws


def ranking(candidates, weights, *, reference=None):
    scorer = ObjectiveScorer()
    bounds = reference if reference is not None else scorer.normalization_reference(candidates)
    scored = scorer.rank(candidates, weights, reference=bounds)
    signatures = sorted(content_hash(normalized({"strategy": p.strategy, "kpis": p.kpis.model_dump(),
                                               "assignments": [a.model_dump() for a in p.schedule.assignments]})) for p in candidates)
    reference_id = content_hash({"version": "objective-minmax:1", "bounds": bounds, "candidates": signatures})
    total = sum(weights.model_dump().values())
    return Ranking(normalization_reference_id=reference_id, reference_bounds=bounds,
        tie_break=["rounded-score-desc:12", "PRODUCTION_PRIORITY", "BALANCED", "RELIABILITY_PRIORITY", "candidate-id-asc"],
        raw_weights=weights, normalized_weights={key: value / total for key, value in weights.model_dump().items()},
        rows=[RankingRow(candidate_plan_id=r.plan.candidate_plan_id, strategy=r.plan.strategy.value, score=r.score,
            raw_kpis=r.plan.kpis.model_dump(), metric_benefits=r.metric_benefits, objective_benefits=r.objective_benefits,
            weighted_contributions=r.weighted_contributions,
            tied_with=[other.plan.candidate_plan_id for other in scored if other.score == r.score and other.plan != r.plan]) for r in scored])


def compare(baseline: Evaluation, scenario: Evaluation):
    def kpis(evaluation):
        selected = next((p for p in evaluation.candidates if p.candidate_plan_id == evaluation.selected_candidate_id), None)
        return selected.kpis.model_dump() if selected else {}
    left, right = kpis(baseline), kpis(scenario)
    metrics = []
    for name, (unit, direction) in METRICS.items():
        a, b = left.get(name), right.get(name)
        reason = None
        if name == "decision_latency_ms":
            a = b = None
            reason = "OPERATIONAL_TELEMETRY_NOT_MODEL_KPI"
        elif a is None:
            reason = "BASELINE_METRIC_MISSING"
        elif b is None:
            reason = "SCENARIO_METRIC_MISSING"
        delta = None if a is None or b is None else b - a
        percent = None if delta is None or a == 0 else 100 * delta / abs(a)
        if delta is not None and a == 0:
            reason = "ZERO_BASELINE"
        change = "UNAVAILABLE" if delta is None else "UNCHANGED" if delta == 0 else (
            "IMPROVED_UNDER_MODEL" if (delta < 0) == (direction == "LOWER") else "WORSENED_UNDER_MODEL")
        metrics.append(MetricComparison(metric=name, unit=unit, preferred_direction=direction, baseline=a, scenario=b,
            absolute_delta=delta, percent_delta=percent, reason=reason, change=change))
    return Comparison(metrics=metrics, model_assumptions=ASSUMPTIONS)


class ScenarioEvaluator:
    def __init__(self, *, cancelled=lambda: False):
        self.cancelled = cancelled

    def check_cancelled(self):
        if self.cancelled():
            raise ScenarioCancelled("Scenario evaluation cancelled")

    def plan(self, request, snapshot, draws, deadline):
        self.check_cancelled()
        # No transport/workspace/run identity participates in the physical result.
        basis_hash = content_hash(normalized({"snapshot": snapshot.model_dump(), "config": request.planning_config.model_dump()}))
        case_id = "scenario-" + basis_hash[:32]
        planning = RunDecisionCaseRequest.model_validate({
            "schema_version": "3.0", "decision_case_id": case_id, "mode": "SIMULATION_ONLY",
            "factory_snapshot": snapshot.model_dump(mode="json"),
            "trigger": {"type": "WHAT_IF", "event_id": case_id, "occurred_at": snapshot.captured_at,
                        "requested_by_user_id": "scenario-engine", "scenario_id": case_id, "assumptions": {}},
            "planning_config": request.planning_config.model_dump(mode="json"), "requested_by_user_id": "scenario-engine",
        })
        service = DecisionPlanningService(constraint_profile=STRICT_PROFILE, check_cancelled=self.check_cancelled,
            simulator=DeterministicSimulator(draw_provider=draws, check_cancelled=self.check_cancelled))
        try:
            result = service.plan_with_diagnostics(planning, deadline=deadline)
        except (NoFeasiblePlan, PlanningTimedOut) as error:
            outcome = "TIMEOUT" if isinstance(error, PlanningTimedOut) else "NO_FEASIBLE_PLAN"
            return Evaluation(outcome=outcome, diagnostics=[Diagnostic(code=error.code, message=str(error)[:1000])],
                candidate_availability=[CandidateAvailability(strategy=STRATEGIES[s], outcome=outcome,
                    reason=(error.diagnostics or {}).get(STRATEGIES[s], str(error))) for s in request.planning_config.allowed_strategy_ids])
        candidates = result.recommendation.candidate_plans
        evidence = ranking(candidates, request.planning_config.objective_weights)
        availability = []
        for strategy in request.planning_config.allowed_strategy_ids:
            name = STRATEGIES[strategy]
            candidate = next((p for p in result.diagnostics.candidate_plans if p.strategy.value == name), None)
            if candidate and candidate.validation.verdict.value == "VALID":
                availability.append(CandidateAvailability(strategy=name, outcome="FEASIBLE"))
            else:
                reason = result.diagnostics.strategy_failures.get(name)
                if candidate:
                    reason = "; ".join(f"{v.constraint_code}: {v.message}" for v in candidate.validation.violations)
                availability.append(CandidateAvailability(strategy=name, outcome="TIMEOUT" if result.diagnostics.timed_out and not candidate else "NO_FEASIBLE_PLAN", reason=reason or "No completed candidate"))
        return Evaluation(outcome="FEASIBLE", candidates=candidates, selected_candidate_id=evidence.rows[0].candidate_plan_id,
            ranking=evidence, candidate_availability=availability, partial=result.diagnostics.timed_out)

    def evaluate(self, request: EvaluationRequest) -> EvaluationResult:
        deadline = time.monotonic() + request.budget.remaining_ms / 1000
        self.check_cancelled()
        effective = transform(request)
        draws = CommonRandomDraws(request.baseline.snapshot, request.sampling)
        baseline = self.plan(request, request.baseline.snapshot, draws, deadline)
        if effective.snapshot is None:
            scenario = Evaluation(outcome="NO_FEASIBLE_PLAN", diagnostics=effective.diagnostics)
        elif effective.snapshot == request.baseline.snapshot:
            scenario = baseline.model_copy(deep=True)
        else:
            scenario = self.plan(request, effective.snapshot, draws, deadline)
        semantic_hash = semantic_input_hash(request, effective, draws)
        unsupported = [o.type for o in request.overrides if not isinstance(o, DeferMaintenance)]
        # The canonical LIVE extension is not advertised until its producer and
        # consumer are integrated; physical Scenario evaluation works independently.
        reasons = ["AUTHORIZED_INGESTION_REQUIRED:" + kind for kind in sorted(set(unsupported))]
        return EvaluationResult(identity=request.identity, semantic_input_hash=semantic_hash, sampling=draws.metadata(),
            effective=effective, baseline=baseline, scenario=scenario, comparison=compare(baseline, scenario),
            live_mapping=LiveMapping(supported=not reasons and scenario.outcome == "FEASIBLE",
                mapped_weights=request.planning_config.objective_weights if not reasons and scenario.outcome == "FEASIBLE" else None,
                mapped_defer_bounds=[o for o in request.overrides if isinstance(o, DeferMaintenance)] if not reasons and scenario.outcome == "FEASIBLE" else [],
                reasons=reasons if scenario.outcome == "FEASIBLE" else [*reasons, "SOURCE_NOT_FEASIBLE"]))
