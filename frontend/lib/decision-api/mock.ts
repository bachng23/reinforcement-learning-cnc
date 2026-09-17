import { rowsFromEvents, sortDecisionQueue } from "@/lib/decision-api/normalize";
import { ProductApiError } from "@/lib/product-api/errors";
import { MOCK_COMPLETED_STEPS, MOCK_ENVIRONMENT_CONFIG } from "@/lib/product-api/fixtures";
import type { JointAction } from "@/types/cnc";
import type { DecisionApiClient, DecisionHistory, DecisionQueueItem, DecisionStatus, MaintenanceDecision, MaintenanceDecisionAction, ReviewAction, ReviewInput } from "@/types/decision";
import type { ProductApiRequestOptions } from "@/types/product-api";

const IDS = [
  {
    observation: "a935403f-08c7-4a47-bca0-366a60d7368b",
    recommendation: "d5394c33-164f-4f4e-ae53-6b53a9fc933b",
    decision: "9fa12ce3-fc45-4cab-aa62-67571f0dadc0",
  },
  {
    observation: "cf8d91c4-00d3-4bef-9c03-fbd3c3564397",
    recommendation: "06da8bae-243f-4805-8293-280b99715dfa",
    decision: "28d73898-9bee-453a-af5b-ce3214404f16",
  },
] as const;

const clone = <T,>(value: T): T => structuredClone(value);

function fixtureRows(known: Map<string, { decisionId: string; status: DecisionStatus }>): DecisionQueueItem[] {
  const groups = IDS.map((ids, index) => {
    const step = MOCK_COMPLETED_STEPS[index + 1];
    return rowsFromEvents({
      experimentId: "558c20ca-eaa3-43e2-bfff-9650ec857563",
      experimentName: "Risk-aware fleet demonstration",
      episodeId: "43e72979-eb62-40bf-b9d7-15406a0b62d2",
      attempt: 1,
      environmentConfig: MOCK_ENVIRONMENT_CONFIG,
      observations: [{
        id: ids.observation,
        observationKey: step.observation?.observation_id,
        step: step.step,
        payload: step.observation,
      }],
      recommendations: [{
        id: ids.recommendation,
        observationId: ids.observation,
        step: step.step,
        payload: step.recommendation,
      }],
      knownStatuses: known,
    });
  });
  return sortDecisionQueue(groups.flat());
}

/** In-memory mock built from the repository's CNC v2 observation/recommendation sample payloads. */
export class MockDecisionApiClient implements DecisionApiClient {
  private readonly decisions = new Map<string, DecisionHistory>();

  constructor() {
    this.decisions.set(IDS[1].recommendation, {
      id: IDS[1].decision,
      recommendationId: IDS[1].recommendation,
      status: "APPROVED",
      createdAt: "2026-09-17T02:30:00.000Z",
      actions: [{
        id: "c30b012b-3465-4187-9306-7a841cb2597b",
        decisionId: IDS[1].decision,
        actorUserId: "878c179a-a0e1-4cd7-aa36-74c48ea99a1b",
        fromStatus: "PENDING_REVIEW",
        toStatus: "APPROVED",
        reason: "Reviewed the fleet context.",
        selectedAction: clone(MOCK_COMPLETED_STEPS[2].recommendation?.actions ?? null),
        recommendationSnapshot: { payload: clone(MOCK_COMPLETED_STEPS[2].recommendation) },
        riskSnapshot: { observation: clone(MOCK_COMPLETED_STEPS[2].observation), environmentConfig: clone(MOCK_ENVIRONMENT_CONFIG) },
        createdAt: "2026-09-17T02:31:00.000Z",
      }],
    });
  }

  private check(options: ProductApiRequestOptions): void {
    if (options.signal?.aborted) {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    }
  }

  async listQueue(options: ProductApiRequestOptions = {}): Promise<DecisionQueueItem[]> {
    this.check(options);
    const known = new Map([...this.decisions].map(([id, decision]) => [id, {
      decisionId: decision.id,
      status: decision.status as DecisionStatus,
    }]));
    return clone(fixtureRows(known));
  }

  async openReview(recommendationId: string, options: ProductApiRequestOptions = {}): Promise<MaintenanceDecision> {
    this.check(options);
    let decision = this.decisions.get(recommendationId);
    if (!decision) {
      const ids = IDS.find((item) => item.recommendation === recommendationId);
      if (!ids) throw new ProductApiError("Recommendation was not found.", { status: 404, code: "RECOMMENDATION_NOT_FOUND" });
      decision = {
        id: ids.decision,
        recommendationId,
        status: "PENDING_REVIEW",
        createdAt: new Date().toISOString(),
        actions: [],
      };
      this.decisions.set(recommendationId, decision);
    }
    const { actions: _actions, ...resource } = decision;
    return clone(resource);
  }

  async getHistory(decisionId: string, options: ProductApiRequestOptions = {}): Promise<DecisionHistory> {
    this.check(options);
    const decision = [...this.decisions.values()].find((value) => value.id === decisionId);
    if (!decision) throw new ProductApiError("Decision was not found.", { status: 404, code: "DECISION_NOT_FOUND" });
    return clone(decision);
  }

  async submitReview(
    decisionId: string,
    action: ReviewAction,
    input: ReviewInput,
    options: ProductApiRequestOptions = {},
  ): Promise<MaintenanceDecisionAction> {
    this.check(options);
    const decision = [...this.decisions.values()].find((value) => value.id === decisionId);
    if (!decision) throw new ProductApiError("Decision was not found.", { status: 404, code: "DECISION_NOT_FOUND" });
    if (decision.status !== "PENDING_REVIEW") {
      throw new ProductApiError("Decision is no longer PENDING_REVIEW.", { status: 409, code: "INVALID_DECISION_TRANSITION" });
    }
    const row = fixtureRows(new Map()).find((value) => value.recommendationId === decision.recommendationId);
    if (!row) throw new ProductApiError("Recommendation was not found.", { status: 404 });
    const replacement = "replacementAction" in input ? input.replacementAction : undefined;
    if (action === "override") {
      const expected = row.observation.machines.map((machine) => machine.machine_id).sort();
      const supplied = replacement?.actions.map((machine) => machine.machine_id).sort();
      const changed = replacement?.actions.some((machine) => row.recommendation.actions.actions.find(
        (original) => original.machine_id === machine.machine_id && original.action !== machine.action,
      ));
      if (!input.reason?.trim() || !replacement || replacement.observation_id !== row.observationKey ||
        JSON.stringify(expected) !== JSON.stringify(supplied) || !changed) {
        throw new ProductApiError("Replacement must cover the same observation and machines and change at least one action.", {
          status: 400,
          code: "INVALID_REPLACEMENT_ACTION",
        });
      }
    }
    const toStatus = action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "OVERRIDDEN";
    const review: MaintenanceDecisionAction = {
      id: crypto.randomUUID(),
      decisionId,
      actorUserId: "878c179a-a0e1-4cd7-aa36-74c48ea99a1b",
      fromStatus: "PENDING_REVIEW",
      toStatus,
      reason: input.reason?.trim() || null,
      selectedAction: action === "reject" ? null : clone((replacement ?? row.recommendation.actions) as JointAction),
      recommendationSnapshot: { id: row.recommendationId, policyId: row.policyId, payload: clone(row.recommendation) },
      riskSnapshot: { observation: clone(row.observation), environmentConfig: clone(row.environmentConfig) },
      createdAt: new Date().toISOString(),
    };
    decision.status = toStatus;
    decision.actions.push(review);
    return clone(review);
  }
}
