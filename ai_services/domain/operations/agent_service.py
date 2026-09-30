"""Read-only agent analysis composed with the deterministic planning facade."""

from __future__ import annotations

import time
from dataclasses import dataclass

from domain.operations.agent_workflow import (
    AgentWorkflowResult,
    ResourceReport,
    run_specialist_analysis,
)
from domain.operations.contracts import RecommendationPackage, RunDecisionCaseRequest
from domain.operations.service import DecisionPlanningService, PlanningDiagnostics


@dataclass(frozen=True)
class AgentPlanningMetrics:
    duration_ms: int
    feasible_candidate_count: int
    rejected_candidate_count: int
    candidate_feasibility_rate: float
    tool_failure_rate: float


@dataclass(frozen=True)
class AgentPlanningResult:
    """Internal result retaining analysis and rejected-candidate diagnostics."""

    recommendation: RecommendationPackage
    analysis: AgentWorkflowResult
    diagnostics: PlanningDiagnostics
    metrics: AgentPlanningMetrics


class AgentPlanningService:
    """Gather evidence, then delegate all schedule decisions to the validated planner.

    The analysis stage is deliberately read-only. It neither rewrites the snapshot nor
    chooses a strategy; its run IDs are attached to candidates for auditability.
    """

    def __init__(self, planner: DecisionPlanningService | None = None) -> None:
        self.planner = planner or DecisionPlanningService()

    def plan(self, request: RunDecisionCaseRequest) -> RecommendationPackage:
        return self.plan_with_analysis(request).recommendation

    def plan_with_analysis(self, request: RunDecisionCaseRequest) -> AgentPlanningResult:
        started = time.monotonic()
        analysis = run_specialist_analysis(
            request.factory_snapshot,
            decision_case_id=request.decision_case_id,
        )
        source_run_ids = tuple(
            sorted({call.agent_run_id for call in analysis.tool_calls})
        )
        planning = self.planner.plan_with_diagnostics(
            request,
            source_agent_run_ids=source_run_ids,
        )
        candidate_count = len(planning.diagnostics.candidate_plans)
        rejected_count = len(planning.diagnostics.rejected_plan_ids)
        feasible_count = candidate_count - rejected_count
        return AgentPlanningResult(
            recommendation=planning.recommendation,
            analysis=analysis,
            diagnostics=planning.diagnostics,
            metrics=AgentPlanningMetrics(
                duration_ms=max(0, round((time.monotonic() - started) * 1000)),
                feasible_candidate_count=feasible_count,
                rejected_candidate_count=rejected_count,
                candidate_feasibility_rate=(
                    feasible_count / candidate_count if candidate_count else 0.0
                ),
                tool_failure_rate=analysis.metrics.tool_failure_rate,
            ),
        )

    @staticmethod
    def unstaffed_request_ids(analysis: AgentWorkflowResult) -> list[str]:
        report = analysis.reports.get("resource-specialist")
        if not isinstance(report, ResourceReport):
            return []
        return sorted(
            match.maintenance_request_id
            for match in report.matches
            if match.unstaffed
        )
