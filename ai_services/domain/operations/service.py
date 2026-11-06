"""Planning facade: request -> schedules -> validation -> KPIs -> recommendation."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field

from domain.operations.contracts import (
    CandidatePlan,
    PlanStrategy,
    PlanValidation,
    RecommendationPackage,
    RunDecisionCaseRequest,
    ValidationVerdict,
)
from domain.operations.recommendation import RecommendationBuilder
from domain.operations.scheduler import (
    DeterministicScheduler,
    NoFeasiblePlanError,
    PlanningTimeoutError,
)
from domain.operations.scoring import ObjectiveScorer
from domain.operations.simulator import DeterministicSimulator
from domain.operations.validator import OperationsValidatorV1


ENGINE_ID = "deterministic-decision-planner"
ENGINE_VERSION = "1.0.0"


@dataclass(frozen=True)
class PlanningDiagnostics:
    """Internal audit view. Invalid candidates never leave in a recommendation."""

    candidate_plans: list[CandidatePlan]
    validations: list[PlanValidation]
    rejected_plan_ids: list[str]
    timed_out: bool = False
    strategy_failures: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PlanningResult:
    recommendation: RecommendationPackage
    diagnostics: PlanningDiagnostics


class DecisionPlanningError(Exception):
    code = "PLANNING_ERROR"

    def __init__(self, message, *, diagnostics=None):
        super().__init__(message)
        self.diagnostics = diagnostics


class NoFeasiblePlan(DecisionPlanningError):
    code = "NO_FEASIBLE_PLAN"


class PlanningTimedOut(DecisionPlanningError):
    code = "PLANNING_TIMEOUT"


def _plan_id(request: RunDecisionCaseRequest, strategy: PlanStrategy) -> str:
    digest = hashlib.sha256(
        f"{request.decision_case_id}|{request.factory_snapshot.snapshot_id}|"
        f"{strategy.value}".encode("utf-8")
    ).hexdigest()[:16]
    return f"plan-{strategy.value.lower()}-{digest}"


class DecisionPlanningService:
    """Synchronous facade with deterministic inputs and no persistence side effects."""

    def __init__(
        self,
        *,
        validator: OperationsValidatorV1 | None = None,
        simulator: DeterministicSimulator | None = None,
        scorer: ObjectiveScorer | None = None,
        recommendation_builder: RecommendationBuilder | None = None,
        constraint_profile: str = "legacy-v1",
        check_cancelled=None,
    ) -> None:
        if constraint_profile not in {"legacy-v1", "scenario-strict:1"}:
            raise ValueError("unsupported constraint profile")
        if validator is not None and getattr(validator, "constraint_profile", "legacy-v1") != constraint_profile:
            raise ValueError("validator and scheduler constraint profiles must match")
        self.constraint_profile = constraint_profile
        self.check_cancelled = check_cancelled
        self.validator = validator or OperationsValidatorV1(constraint_profile=constraint_profile)
        self.simulator = simulator or DeterministicSimulator()
        self.scorer = scorer or ObjectiveScorer()
        self.recommendation_builder = recommendation_builder or RecommendationBuilder()

    def plan(self, request: RunDecisionCaseRequest) -> RecommendationPackage:
        return self.plan_with_diagnostics(request).recommendation

    def plan_with_diagnostics(self, request: RunDecisionCaseRequest, *, deadline: float | None = None) -> PlanningResult:
        bounds = getattr(request.trigger, 'maintenance_start_constraints', [])
        if bounds:
            from domain.operations.maintenance_constraints import with_start_constraints
            try:
                snapshot = with_start_constraints(request.factory_snapshot, bounds)
            except ValueError as error:
                raise NoFeasiblePlan('Maintenance start constraints conflict with pinned hard bounds') from error
            effective = request.model_copy(update={"factory_snapshot": snapshot,
                "trigger": request.trigger.model_copy(update={"maintenance_start_constraints": []})})
            return DecisionPlanningService(constraint_profile="scenario-strict:1", simulator=self.simulator,
                scorer=self.scorer, recommendation_builder=self.recommendation_builder,
                check_cancelled=self.check_cancelled).plan_with_diagnostics(effective, deadline=deadline)
        strategies = self._strategies(request)
        point_deadline = time.monotonic() + request.planning_config.solver_timeout_seconds
        deadline = min(deadline, point_deadline) if deadline is not None else point_deadline
        candidates: list[CandidatePlan] = []
        validations: list[PlanValidation] = []
        timed_out = False
        last_infeasibility: Exception | None = None
        strategy_failures = {}

        for strategy in strategies:
            try:
                scheduled = DeterministicScheduler(
                    request.factory_snapshot, deadline, constraint_profile=self.constraint_profile, check_cancelled=self.check_cancelled
                ).build(strategy, request.decision_case_id)
                plan_id = _plan_id(request, strategy)
                provisional = CandidatePlan(
                    candidate_plan_id=plan_id,
                    decision_case_id=request.decision_case_id,
                    snapshot_id=request.factory_snapshot.snapshot_id,
                    plan_version=(
                        (request.factory_snapshot.current_schedule.revision + 1)
                        if request.factory_snapshot.current_schedule
                        else 1
                    ),
                    strategy=strategy,
                    source_engine_id=ENGINE_ID,
                    source_engine_version=ENGINE_VERSION,
                    generated_at=request.factory_snapshot.captured_at,
                    schedule=scheduled.schedule,
                    kpis=self.simulator.calculate(
                        request.factory_snapshot,
                        scheduled.schedule,
                        seed=request.planning_config.base_seed,
                        simulation_runs=request.planning_config.simulation_runs,
                        deadline=deadline,
                    ),
                    assumptions=[
                        *scheduled.assumptions,
                        "Failure simulation uses snapshot health probability and a 70% "
                        "maintenance risk reduction.",
                    ],
                    warnings=[],
                )
                validation = self.validator.validate(
                    request.factory_snapshot,
                    provisional,
                    seed=request.planning_config.base_seed,
                ).model_copy(
                    update={"simulation_runs": request.planning_config.simulation_runs}
                )
                candidate = provisional.model_copy(update={"validation": validation})
                candidates.append(candidate)
                validations.append(validation)
            except PlanningTimeoutError:
                strategy_failures[strategy.value] = "Planning deadline exceeded"
                timed_out = True
                break
            except NoFeasiblePlanError as exc:
                strategy_failures[strategy.value] = str(exc)
                last_infeasibility = exc
                continue

        valid = [
            candidate
            for candidate in candidates
            if candidate.validation is not None
            and candidate.validation.verdict is ValidationVerdict.VALID
        ]
        if not valid:
            if timed_out:
                raise PlanningTimedOut("planning timed out before a valid candidate was found", diagnostics=strategy_failures)
            message = str(last_infeasibility) if last_infeasibility else "no feasible candidate"
            for candidate in candidates:
                if candidate.validation and candidate.validation.verdict is ValidationVerdict.INVALID:
                    strategy_failures[candidate.strategy.value] = "; ".join(
                        f"{v.constraint_code}: {v.message}" for v in candidate.validation.violations)
            raise NoFeasiblePlan(message, diagnostics=strategy_failures)

        # Timeout policy: return only valid best-known candidates that completed
        # before the deadline; never emit a partially built candidate.
        ranked = self.scorer.rank(valid, request.planning_config.objective_weights)
        ordered_valid = [item.plan for item in ranked]
        recommendation = self.recommendation_builder.build(request, ordered_valid)
        rejected = [
            candidate.candidate_plan_id
            for candidate in candidates
            if candidate.validation is None
            or candidate.validation.verdict is not ValidationVerdict.VALID
        ]
        return PlanningResult(
            recommendation=recommendation,
            diagnostics=PlanningDiagnostics(
                candidate_plans=candidates,
                validations=validations,
                rejected_plan_ids=rejected,
                timed_out=timed_out,
                strategy_failures=strategy_failures,
            ),
        )

    @staticmethod
    def _strategies(request: RunDecisionCaseRequest) -> list[PlanStrategy]:
        supported = [
            ("production-priority", PlanStrategy.PRODUCTION_PRIORITY),
            ("balanced", PlanStrategy.BALANCED),
            ("reliability-priority", PlanStrategy.RELIABILITY_PRIORITY),
        ]
        by_id = dict(supported)
        allowed = request.planning_config.allowed_strategy_ids
        selected = (
            [by_id[strategy_id] for strategy_id in allowed if strategy_id in by_id]
            if allowed
            else [strategy for _, strategy in supported]
        )
        return selected[: request.planning_config.candidate_limit]
