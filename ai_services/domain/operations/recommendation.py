"""Build render-ready RecommendationPackage values from ranked valid candidates."""

from __future__ import annotations

import hashlib

from domain.operations.contracts import (
    AssignmentType,
    CandidatePlan,
    FactorySnapshot,
    RecommendationExplanation,
    RecommendationPackage,
    RunDecisionCaseRequest,
)


def _recommendation_id(request: RunDecisionCaseRequest, plan: CandidatePlan) -> str:
    digest = hashlib.sha256(
        f"{request.decision_case_id}|{request.factory_snapshot.snapshot_id}|"
        f"{plan.candidate_plan_id}".encode("utf-8")
    ).hexdigest()[:16]
    return f"recommendation-{digest}"


class RecommendationBuilder:
    def build(
        self,
        request: RunDecisionCaseRequest,
        ranked_candidates: list[CandidatePlan],
    ) -> RecommendationPackage:
        if not ranked_candidates:
            raise ValueError("cannot build a recommendation without valid candidates")
        recommended = ranked_candidates[0]
        explanation = self._explanation(request.factory_snapshot, request, recommended)
        return RecommendationPackage(
            recommendation_id=_recommendation_id(request, recommended),
            decision_case_id=request.decision_case_id,
            snapshot_id=request.factory_snapshot.snapshot_id,
            generated_at=request.factory_snapshot.captured_at,
            recommended_plan_id=recommended.candidate_plan_id,
            candidate_plans=ranked_candidates,
            explanation=explanation,
        )

    def _explanation(
        self,
        snapshot: FactorySnapshot,
        request: RunDecisionCaseRequest,
        candidate: CandidatePlan,
    ) -> RecommendationExplanation:
        maintenance = [
            assignment
            for assignment in candidate.schedule.assignments
            if assignment.assignment_type is AssignmentType.MAINTENANCE
        ]
        health_refs = [health.health_snapshot_id for health in snapshot.health_snapshots]
        request_refs = [
            assignment.maintenance_request_id
            for assignment in maintenance
            if assignment.maintenance_request_id is not None
        ]
        assignment_refs = [assignment.assignment_id for assignment in maintenance]
        evidence_refs = list(
            dict.fromkeys(
                [
                    snapshot.snapshot_id,
                    request.trigger.event_id,
                    *health_refs,
                    *request_refs,
                    *assignment_refs,
                ]
            )
        )
        tradeoff = (
            f"Strategy {candidate.strategy.value} yields makespan "
            f"{candidate.kpis.makespan_minutes:.0f} minutes with failure probability "
            f"{candidate.kpis.failure_probability:.3f}."
        )
        reasons = [
            "The selected schedule passed operations-validator-v1.",
            "Ranking uses normalized production, reliability, maintenance, workforce, "
            "and stability objectives.",
        ]
        if maintenance:
            reasons.append("Qualified technicians are assigned to scheduled maintenance work.")
        risks = []
        if health_refs:
            risks.append(
                "Residual failure risk is estimated from the snapshot health observations."
            )
        return RecommendationExplanation(
            summary=(
                f"Recommended {candidate.strategy.value} plan "
                f"{candidate.candidate_plan_id} from "
                f"{len(candidate.schedule.assignments)} assignments."
            ),
            primary_reasons=reasons,
            tradeoffs=[tradeoff],
            residual_risks=risks,
            evidence_refs=evidence_refs or [snapshot.snapshot_id],
        )
