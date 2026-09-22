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
  episodeId: string;
  observationId?: string;
  attempt: number;
  step: number;
  machineId: string;
  toolId?: string;
  jobId?: string;
  recommendedAction: ToolAction | "REPLACE_NOW" | "SCHEDULE_REPLACEMENT" | "DEFER";
  severity?: string;
  failureRisk?: number;
  predictedRulSteps?: number | null;
  observedWearUm?: number;
  posteriorMedianWearUm?: number;
  failureThresholdUm?: number;
  loadClass?: "LIGHT" | "NOMINAL" | "HEAVY";
  sparesAvailable?: number;
  inventoryCapacity?: number;
  predictedExpectedCost?: number | null;
  predictedCvarCost?: number | null;
  costOfDelay?: number | null;
  rationale?: string;
  result?: { outcome: string; incurredCost: number };
  policyId?: string;
  predictedCost?: number;
  deferConsequence?: string;
  status: DecisionStatus;
  createdAt?: string;
  experimentName?: string;
  observationKey?: string;
  observation?: FleetObservation;
  recommendation?: PolicyRecommendation;
  environmentConfig?: EnvironmentConfig;
}

export interface DecisionContext {
  experimentName: string;
  observationKey: string;
  observation: FleetObservation;
  recommendation: PolicyRecommendation;
  environmentConfig: EnvironmentConfig;
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
  getContext(item: DecisionQueueItem, options?: ProductApiRequestOptions): Promise<DecisionContext>;
  openReview(recommendationId: string, options?: ProductApiRequestOptions): Promise<MaintenanceDecision>;
  getHistory(decisionId: string, options?: ProductApiRequestOptions): Promise<DecisionHistory>;
  submitReview(
    decisionId: string,
    action: ReviewAction,
    input: ReviewInput,
    options?: ProductApiRequestOptions,
  ): Promise<MaintenanceDecisionAction>;
}
