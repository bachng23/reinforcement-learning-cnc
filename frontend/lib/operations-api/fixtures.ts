import request from "../../../contracts/v3/fixtures/demo-health-alert.json";
import status from "../../../contracts/v3/fixtures/demo-case-status.json";
import scenario from "../../../contracts/v3/examples/demo-scenario.json";
import type { RunDecisionCaseRequest, DecisionCaseStatusResponse, CandidatePlan, RecommendationPackage } from "@/types/generated/operations";

// JSON imports widen enum strings. The contract gate validates these files with
// canonical Pydantic models; consumers get a fresh copy to avoid test pollution.
export function createOperationsDemoFixtures() {
  return {
    request: structuredClone(request) as unknown as RunDecisionCaseRequest,
    status: structuredClone(status) as unknown as DecisionCaseStatusResponse,
  };
}

/** Explicit preview artifact. KPI/validation/schedules are the shared canonical demo values. */
export function createOperationsRecommendationFixture(caseId: string): RecommendationPackage {
  const plans = structuredClone(scenario.candidate_plans) as unknown as [CandidatePlan, ...CandidatePlan[]];
  for (const plan of plans) {
    plan.decision_case_id = caseId;
    plan.schedule.schedule_id = `${plan.schedule.schedule_id}-${caseId}`;
  }
  return {
    schema_version: "3.0", recommendation_id: `recommendation-${caseId}`,
    decision_case_id: caseId, snapshot_id: scenario.factory_snapshot.snapshot_id,
    generated_at: "2026-09-22T00:03:00Z", recommended_plan_id: plans[0].candidate_plan_id,
    candidate_plans: plans,
    explanation: {
      summary: "Canonical demo candidate comparison for preview only.",
      primary_reasons: ["Review the supplied production and maintenance alternatives."],
      tradeoffs: ["Compare the returned KPI values before selecting a candidate."],
      residual_risks: [], evidence_refs: [scenario.validations[0].validation_id, ...scenario.validations.slice(1).map(validation => validation.validation_id)],
    },
  };
}
