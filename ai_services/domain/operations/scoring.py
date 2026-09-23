"""Stable candidate ranking based on normalized planning objectives."""

from __future__ import annotations

from dataclasses import dataclass

from domain.operations.contracts import CandidatePlan, ObjectiveWeights, PlanStrategy


@dataclass(frozen=True)
class ScoredPlan:
    plan: CandidatePlan
    score: float


_STRATEGY_ORDER = {
    PlanStrategy.PRODUCTION_PRIORITY: 0,
    PlanStrategy.BALANCED: 1,
    PlanStrategy.RELIABILITY_PRIORITY: 2,
}


def _benefit(values: list[float], value: float, *, lower_is_better: bool) -> float:
    minimum, maximum = min(values), max(values)
    if minimum == maximum:
        return 1.0
    normalized = (value - minimum) / (maximum - minimum)
    return 1.0 - normalized if lower_is_better else normalized


class ObjectiveScorer:
    def rank(
        self, candidates: list[CandidatePlan], weights: ObjectiveWeights
    ) -> list[ScoredPlan]:
        if not candidates:
            return []
        kpis = [plan.kpis for plan in candidates]
        makespan = [item.makespan_minutes for item in kpis]
        tardiness = [item.total_tardiness_minutes for item in kpis]
        on_time = [item.on_time_completion_rate for item in kpis]
        failures = [item.expected_failure_count for item in kpis]
        downtime = [item.expected_emergency_downtime_minutes for item in kpis]
        maintenance_cost = [item.maintenance_cost for item in kpis]
        technician_utilization = [item.technician_utilization for item in kpis]
        changes = [float(item.schedule_changes) for item in kpis]
        total_weight = (
            weights.production
            + weights.reliability
            + weights.maintenance
            + weights.workforce
            + weights.schedule_stability
        )
        scored: list[ScoredPlan] = []
        for plan in candidates:
            kpi = plan.kpis
            production = (
                _benefit(makespan, kpi.makespan_minutes, lower_is_better=True)
                + _benefit(tardiness, kpi.total_tardiness_minutes, lower_is_better=True)
                + _benefit(on_time, kpi.on_time_completion_rate, lower_is_better=False)
            ) / 3
            reliability = (
                _benefit(failures, kpi.expected_failure_count, lower_is_better=True)
                + _benefit(downtime, kpi.expected_emergency_downtime_minutes, lower_is_better=True)
            ) / 2
            maintenance = _benefit(
                maintenance_cost, kpi.maintenance_cost, lower_is_better=True
            )
            workforce = _benefit(
                technician_utilization,
                kpi.technician_utilization,
                lower_is_better=True,
            )
            stability = _benefit(
                changes, float(kpi.schedule_changes), lower_is_better=True
            )
            score = (
                weights.production * production
                + weights.reliability * reliability
                + weights.maintenance * maintenance
                + weights.workforce * workforce
                + weights.schedule_stability * stability
            ) / total_weight
            scored.append(ScoredPlan(plan=plan, score=round(score, 12)))
        return sorted(
            scored,
            key=lambda item: (
                -item.score,
                _STRATEGY_ORDER[item.plan.strategy],
                item.plan.candidate_plan_id,
            ),
        )
