import type { EnvironmentConfig, FleetObservation, JointAction, PolicyRecommendation, ToolAction } from "@/types/cnc";
import type { ProductApiRequestOptions } from "@/types/product-api";

export type DecisionStatus = "NOT_OPENED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "OVERRIDDEN";
export type ReviewAction = "approve" | "reject" | "override";

/** One queue row per machine action; review remains atomic for the full joint recommendation. */
export interface DecisionQueueItem {
  rowId: string;
  recommendationId: string;
  decisionId?: string;
  experimentId: string;
  experimentName: string;
  episodeId: string;
  attempt: number;
  step: number;
  machineId: string;
  toolId?: string;
  recommendedAction: ToolAction;
  severity?: string;
  failureRisk?: number;
  predictedCost?: number;
  deferConsequence?: string;
  status: DecisionStatus;
  policyId: string;
  observationKey: string;
  observation: FleetObservation;
  recommendation: PolicyRecommendation;
  environmentConfig: EnvironmentConfig;
  createdAt?: string;
}

export interface MaintenanceDecision {
  id: string;
  recommendationId: string;
  status: Exclude<DecisionStatus, "NOT_OPENED">;
  createdAt?: string;
}

export interface MaintenanceDecisionAction {
  id: string;
  decisionId: string;
  actorUserId: string;
  fromStatus: "PENDING_REVIEW";
  toStatus: "APPROVED" | "REJECTED" | "OVERRIDDEN";
  reason: string | null;
  selectedAction: JointAction | null;
  recommendationSnapshot: Record<string, unknown>;
  riskSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface DecisionHistory extends MaintenanceDecision {
  actions: MaintenanceDecisionAction[];
}

export type ReviewInput = { reason?: string } | { reason: string; replacementAction: JointAction };

export interface DecisionApiClient {
  listQueue(options?: ProductApiRequestOptions): Promise<DecisionQueueItem[]>;
  openReview(recommendationId: string, options?: ProductApiRequestOptions): Promise<MaintenanceDecision>;
  getHistory(decisionId: string, options?: ProductApiRequestOptions): Promise<DecisionHistory>;
  submitReview(
    decisionId: string,
    action: ReviewAction,
    input: ReviewInput,
    options?: ProductApiRequestOptions,
  ): Promise<MaintenanceDecisionAction>;
}
