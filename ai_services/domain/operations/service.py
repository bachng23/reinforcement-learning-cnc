"""Planning facade: request -> schedules -> validation -> KPIs -> recommendation."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

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


@dataclass(frozen=True)
class PlanningResult:
    recommendation: RecommendationPackage
    diagnostics: PlanningDiagnostics


class DecisionPlanningError(Exception):
    code = "PLANNING_ERROR"


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
    ) -> None:
        self.validator = validator or OperationsValidatorV1()
        self.simulator = simulator or DeterministicSimulator()
        self.scorer = scorer or ObjectiveScorer()
        self.recommendation_builder = recommendation_builder or RecommendationBuilder()

    def plan(self, request: RunDecisionCaseRequest) -> RecommendationPackage:
        return self.plan_with_diagnostics(request).recommendation

    def plan_with_diagnostics(self, request: RunDecisionCaseRequest) -> PlanningResult:
        strategies = self._strategies(request)
        deadline = time.monotonic() + request.planning_config.solver_timeout_seconds
        candidates: list[CandidatePlan] = []
        validations: list[PlanValidation] = []
        timed_out = False
        last_infeasibility: Exception | None = None

        for strategy in strategies:
            try:
                scheduled = DeterministicScheduler(
                    request.factory_snapshot, deadline
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
                timed_out = True
                break
            except NoFeasiblePlanError as exc:
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
                raise PlanningTimedOut("planning timed out before a valid candidate was found")
            message = str(last_infeasibility) if last_infeasibility else "no feasible candidate"
            raise NoFeasiblePlan(message)

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
