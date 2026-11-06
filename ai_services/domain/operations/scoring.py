"""Stable candidate ranking based on normalized planning objectives."""

from __future__ import annotations

from dataclasses import dataclass, field

from domain.operations.contracts import CandidatePlan, ObjectiveWeights, PlanStrategy


@dataclass(frozen=True)
class ScoredPlan:
    plan: CandidatePlan
    score: float
    metric_benefits: dict[str, float] = field(default_factory=dict)
    objective_benefits: dict[str, float] = field(default_factory=dict)
    weighted_contributions: dict[str, float] = field(default_factory=dict)


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
    metric_directions = {
        "makespan_minutes": True, "total_tardiness_minutes": True,
        "on_time_completion_rate": False, "expected_failure_count": True,
        "expected_emergency_downtime_minutes": True, "maintenance_cost": True,
        "technician_utilization": True, "schedule_changes": True,
    }

    def normalization_reference(self, candidates: list[CandidatePlan]) -> dict[str, list[float]]:
        if not candidates:
            return {}
        return {name: [min(getattr(c.kpis, name) for c in candidates), max(getattr(c.kpis, name) for c in candidates)]
                for name in self.metric_directions}

    def rank(
        self, candidates: list[CandidatePlan], weights: ObjectiveWeights,
        *, reference: dict[str, list[float]] | None = None,
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
        if reference is not None:
            if set(reference) != set(self.metric_directions):
                raise ValueError("normalization reference has unsupported or missing metrics")
            for name, bounds in reference.items():
                if len(bounds) != 2 or bounds[0] > bounds[1] or any(
                    not bounds[0] <= getattr(candidate.kpis, name) <= bounds[1] for candidate in candidates
                ):
                    raise ValueError("candidate lies outside normalization reference")
            makespan = reference["makespan_minutes"]
            tardiness = reference["total_tardiness_minutes"]
            on_time = reference["on_time_completion_rate"]
            failures = reference["expected_failure_count"]
            downtime = reference["expected_emergency_downtime_minutes"]
            maintenance_cost = reference["maintenance_cost"]
            technician_utilization = reference["technician_utilization"]
            changes = reference["schedule_changes"]
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
            metric_values = dict(zip(self.metric_directions, [makespan, tardiness, on_time, failures, downtime,
                                                             maintenance_cost, technician_utilization, changes]))
            benefits = {name: _benefit(metric_values[name], getattr(kpi, name), lower_is_better=lower)
                        for name, lower in self.metric_directions.items()}
            objectives = {"production": production, "reliability": reliability, "maintenance": maintenance,
                          "workforce": workforce, "schedule_stability": stability}
            contributions = {name: value * getattr(weights, name) / total_weight for name, value in objectives.items()}
            scored.append(ScoredPlan(plan=plan, score=round(score, 12), metric_benefits=benefits,
                                    objective_benefits=objectives, weighted_contributions=contributions))
        return sorted(
            scored,
            key=lambda item: (
                -item.score,
                _STRATEGY_ORDER[item.plan.strategy],
                item.plan.candidate_plan_id,
            ),
        )
