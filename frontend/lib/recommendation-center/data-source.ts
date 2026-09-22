import {
  OperationsApiError,
  type OperationsApiClient,
  type OperationsRequestOptions,
} from "@/lib/operations-api/client";
import { getOperationsFixture } from "@/lib/operations/fixtures";
import type { DecisionCaseStatusResponse } from "@/types/generated/operations";
import type {
  DecisionCaseSummary,
  RecommendationPackage,
  Schedule,
} from "@/types/operations";

export type RecommendationCenterPreviewData = {
  source: "mock";
  caseStatus: DecisionCaseSummary;
  recommendation: RecommendationPackage;
  modifiedSchedule: Schedule;
};

export type RecommendationCenterStatusData = {
  source: "real";
  caseStatus: DecisionCaseStatusResponse;
  recommendation: null;
};

export type RecommendationCenterData =
  | RecommendationCenterPreviewData
  | RecommendationCenterStatusData;

export interface RecommendationCenterDataSource {
  readonly mode: "mock" | "real";
  readonly defaultCaseId?: string;
  read(caseId: string, options?: OperationsRequestOptions): Promise<RecommendationCenterData>;
}

function missingMockCase(caseId: string) {
  return new OperationsApiError(404, {
    schema_version: "3.0",
    error_id: "mock-recommendation-case-not-found",
    code: "DECISION_CASE_NOT_FOUND",
    message: `Decision case ${caseId} was not found in the canonical preview fixture.`,
    correlation_id: "mock-recommendation-center",
    retryable: false,
    details: [],
  });
}

export function createMockRecommendationCenterDataSource(): RecommendationCenterDataSource {
  const initialFixture = getOperationsFixture();
  const defaultCaseId = initialFixture.decision_cases[0]?.decision_case_id;

  return {
    mode: "mock",
    defaultCaseId,
    async read(caseId, options) {
      options?.signal?.throwIfAborted();
      const fixture = getOperationsFixture();
      const caseStatus = fixture.decision_cases.find((item) => item.decision_case_id === caseId);
      if (!caseStatus) throw missingMockCase(caseId);
      options?.signal?.throwIfAborted();
      return {
        source: "mock",
        caseStatus,
        recommendation: fixture.recommendation,
        modifiedSchedule: fixture.modified_schedule,
      };
    },
  };
}

export function createRealRecommendationCenterDataSource(
  api: OperationsApiClient,
): RecommendationCenterDataSource {
  return {
    mode: "real",
    async read(caseId, options) {
      const caseStatus = await api.getDecisionCase(caseId, options);
      return { source: "real", caseStatus, recommendation: null };
    },
  };
}

export function getRecommendationCenterCaseId(): string | undefined {
  return process.env.NEXT_PUBLIC_OPERATIONS_DECISION_CASE_ID?.trim() || undefined;
}
