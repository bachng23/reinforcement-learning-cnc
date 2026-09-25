import {
  OperationsApiError,
  type OperationsApiClient,
  type OperationsDecisionCaseMeta,
  type OperationsRequestOptions,
} from "@/lib/operations-api/client";
import { getOperationsFixture } from "@/lib/operations/fixtures";
import type {
  DecisionCaseStatusResponse,
  FactorySnapshot,
  RecommendationPackage,
  Schedule,
} from "@/types/generated/operations";

export type RecommendationCenterPreviewData = {
  source: "mock";
  caseStatus: DecisionCaseStatusResponse;
  recommendation: RecommendationPackage;
  snapshot: FactorySnapshot;
  modifiedSchedule: Schedule;
};

type RecommendationCenterRealBase = {
  source: "real";
  caseStatus: DecisionCaseStatusResponse;
  caseMeta?: OperationsDecisionCaseMeta;
};

export type RecommendationCenterStatusData = RecommendationCenterRealBase & (
  | {
    artifactState: "ready";
    recommendation: RecommendationPackage;
    snapshot: FactorySnapshot;
    message?: never;
  }
  | {
    artifactState: "pending" | "blocked" | "mismatch";
    recommendation: null;
    snapshot: null;
    message?: string;
  }
);

export type RecommendationCenterData =
  | RecommendationCenterPreviewData
  | RecommendationCenterStatusData;

export interface RecommendationCenterDataSource {
  readonly mode: "mock" | "real";
  readonly defaultCaseId?: string;
  read(caseId: string, options?: OperationsRequestOptions): Promise<RecommendationCenterData>;
}

const POLLING_STATUSES = new Set<DecisionCaseStatusResponse["status"]>([
  "CREATED",
  "ANALYZING",
  "GENERATING",
  "VALIDATING",
  "EXPLAINING",
]);
const ARTIFACT_STATUSES = new Set<DecisionCaseStatusResponse["status"]>([
  "AWAITING_APPROVAL",
  "APPROVED",
  "MODIFIED",
  "REJECTED",
  "COMMITTED",
]);

export function isRecommendationPollingStatus(status: DecisionCaseStatusResponse["status"]): boolean {
  return POLLING_STATUSES.has(status);
}

function realWithoutArtifact(
  caseStatus: DecisionCaseStatusResponse,
  caseMeta: OperationsDecisionCaseMeta | undefined,
  artifactState: Exclude<RecommendationCenterStatusData["artifactState"], "ready">,
  message?: string,
): RecommendationCenterStatusData {
  return {
    source: "real",
    caseStatus,
    caseMeta,
    artifactState,
    recommendation: null,
    snapshot: null,
    message,
  };
}

function recommendationErrorCode(error: OperationsApiError): string | undefined {
  return error.apiError?.code ?? error.contractError?.code;
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
        caseStatus: {
          schema_version: caseStatus.schema_version,
          decision_case_id: caseStatus.decision_case_id,
          mode: caseStatus.mode,
          status: caseStatus.status,
          snapshot_id: caseStatus.snapshot_id,
          created_at: caseStatus.created_at,
          updated_at: caseStatus.updated_at,
          recommendation_id: caseStatus.recommendation_id,
          committed_schedule_id: caseStatus.committed_schedule_id,
          error_code: caseStatus.error_code,
        },
        // The preview fixture is contract-shaped but predates generated-type adoption.
        // Clone it at this boundary so all UI consumers use the generated v3 types.
        recommendation: structuredClone(fixture.recommendation) as unknown as RecommendationPackage,
        snapshot: structuredClone(fixture.factory_snapshot) as unknown as FactorySnapshot,
        modifiedSchedule: structuredClone(fixture.modified_schedule) as unknown as Schedule,
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
      const { caseStatus, meta: caseMeta } = await api.getDecisionCase(caseId, options);
      options?.signal?.throwIfAborted();

      if (caseStatus.decision_case_id !== caseId) {
        return realWithoutArtifact(caseStatus, caseMeta, "mismatch", "The case response does not match the requested decision case.");
      }

      if (caseStatus.status === "FAILED" || caseStatus.status === "CANCELLED") {
        return realWithoutArtifact(caseStatus, caseMeta, "blocked");
      }

      if (!caseStatus.recommendation_id) {
        if (isRecommendationPollingStatus(caseStatus.status)) {
          return realWithoutArtifact(caseStatus, caseMeta, "pending");
        }
        return realWithoutArtifact(caseStatus, caseMeta, "mismatch", "The terminal case response does not include a recommendation reference.");
      }

      if (!ARTIFACT_STATUSES.has(caseStatus.status)) {
        return realWithoutArtifact(caseStatus, caseMeta, "mismatch", "The case exposes a recommendation reference before reaching an artifact-readable stage.");
      }

      let artifact;
      try {
        artifact = await api.getDecisionCaseRecommendation(caseId, options);
      } catch (error: unknown) {
        if (error instanceof OperationsApiError && error.status === 404 && recommendationErrorCode(error) === "RECOMMENDATION_NOT_READY") {
          return realWithoutArtifact(caseStatus, caseMeta, "pending", "The recommendation artifact is not ready yet.");
        }
        throw error;
      }
      options?.signal?.throwIfAborted();

      const { recommendation, snapshot } = artifact;
      if (
        recommendation.decision_case_id !== caseStatus.decision_case_id
        || recommendation.snapshot_id !== caseStatus.snapshot_id
        || snapshot.snapshot_id !== caseStatus.snapshot_id
        || recommendation.recommendation_id !== caseStatus.recommendation_id
      ) {
        return realWithoutArtifact(caseStatus, caseMeta, "mismatch", "The recommendation artifact identifiers do not match the authoritative case and basis snapshot.");
      }

      return {
        source: "real",
        caseStatus,
        caseMeta,
        artifactState: "ready",
        recommendation,
        snapshot,
      };
    },
  };
}

export function getRecommendationCenterCaseId(): string | undefined {
  return process.env.NEXT_PUBLIC_OPERATIONS_DECISION_CASE_ID?.trim() || undefined;
}
