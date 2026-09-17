import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthRedirectError, authFetch } from "@/lib/auth";
import { HttpDecisionApiClient } from "@/lib/decision-api/client";
import { ProductApiError } from "@/lib/product-api/errors";
import { MOCK_COMPLETED_STEPS, MOCK_EXPERIMENT_DETAILS } from "@/lib/product-api/fixtures";
import { createProductApiStub } from "@/tests/product-api-test-utils";

const recommendationId = "d5394c33-164f-4f4e-ae53-6b53a9fc933b";
const observationId = "a935403f-08c7-4a47-bca0-366a60d7368b";
const decisionId = "9fa12ce3-fc45-4cab-aa62-67571f0dadc0";
const sample = MOCK_COMPLETED_STEPS[1];
const fullExperiment = MOCK_EXPERIMENT_DETAILS[0];
const experiment = { ...fullExperiment, episodes: fullExperiment.episodes.slice(0, 1) };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeProductStub() {
  return createProductApiStub({
    listExperiments: vi.fn(async () => ({
      items: [experiment], page: 1, page_size: 100, total_items: 1,
      total_pages: 1, has_next: false, has_previous: false,
    })),
    getExperiment: vi.fn(async () => experiment),
  });
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("HttpDecisionApiClient", () => {
  it("loads the authoritative decision queue from the Maintenance API", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/maintenance/decisions?")) return json({
        success: true,
        data: [{
          id: `${recommendationId}~machine-01`, decisionId: null, status: "PENDING_REVIEW", machineId: "machine-01", toolId: "tool-01", jobId: null,
          source: { experimentId: experiment.id, episodeId: experiment.episodes[0].id, observationId, recommendationId, attempt: 1, step: sample.step },
          recommendedAction: "REPLACE_NOW", severity: "HIGH", risk: { predictedRulSteps: 2, failureProbabilityNextStep: 0.3, observedWearUm: 10, posteriorMedianWearUm: 9, failureThresholdUm: 20, condition: { loadClass: "NOMINAL" } },
          resources: { sparesAvailable: 1, inventoryCapacity: 2 }, predictedCost: { expected: 25, cvar: null }, costOfDelay: { amount: 30 }, rationale: "Policy recommends replacement.", result: { outcome: "REPLACED", incurredCost: 25 },
        }], meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
      throw new Error(`Unexpected request: ${path}`);
    });
    const api = new HttpDecisionApiClient(fetcher, makeProductStub());

    const queue = await api.listQueue();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/maintenance/decisions?page=1&limit=100");
    expect(queue).toEqual([expect.objectContaining({ recommendationId, status: "PENDING_REVIEW", severity: "HIGH", failureRisk: 0.3 })]);
  });

  it("opens an idempotent review, sends the override contract, and reloads audit history", async () => {
    const actorUserId = "878c179a-a0e1-4cd7-aa36-74c48ea99a1b";
    const decision = { id: decisionId, recommendationId, status: "PENDING_REVIEW", createdAt: "2026-09-17T01:00:00.000Z" };
    const action = {
      id: "c30b012b-3465-4187-9306-7a841cb2597b", decisionId, actorUserId,
      fromStatus: "PENDING_REVIEW", toStatus: "OVERRIDDEN", reason: "Tool inspection",
      selectedAction: sample.recommendation?.actions, recommendationSnapshot: {}, riskSnapshot: {},
      createdAt: "2026-09-17T01:01:00.000Z",
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/maintenance/decisions")) return json({ success: true, data: decision });
      if (path.endsWith("/override")) return json({ success: true, data: { id: decisionId, status: "OVERRIDDEN", action } });
      if (path.endsWith("/history")) return json({ success: true, data: { ...decision, status: "OVERRIDDEN", actions: [action] } });
      throw new Error(`Unexpected request: ${path} ${init?.method}`);
    });
    const api = new HttpDecisionApiClient(fetcher, makeProductStub());
    const replacementAction = {
      ...sample.recommendation!.actions,
      actions: sample.recommendation!.actions.actions.map((entry, index) => ({
        ...entry, action: index === 0 ? (entry.action === "REPLACE" ? "CONTINUE" : "REPLACE") as "CONTINUE" | "REPLACE" : entry.action,
      })),
    };

    expect(await api.openReview(recommendationId)).toMatchObject(decision);
    await api.submitReview(decisionId, "override", { reason: "Tool inspection", replacementAction });
    expect(await api.getHistory(decisionId)).toMatchObject({ status: "OVERRIDDEN", actions: [{ reason: "Tool inspection" }] });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ recommendationId });
    expect(String(fetcher.mock.calls[1][0])).toBe(`/api/v1/maintenance/decisions/${decisionId}/override`);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ reason: "Tool inspection", replacementAction });
  });

  it("propagates authorization and conflict errors, and labels network failures", async () => {
    const productApi = makeProductStub();
    await expect(new HttpDecisionApiClient(vi.fn(async () => { throw new AuthRedirectError(); }), productApi)
      .openReview(recommendationId)).rejects.toBeInstanceOf(AuthRedirectError);
    await expect(new HttpDecisionApiClient(vi.fn(async () => json({ success: false, error: { message: "Already reviewed" } }, 409)), productApi)
      .openReview(recommendationId)).rejects.toMatchObject({ status: 409, message: "Already reviewed" });
    await expect(new HttpDecisionApiClient(vi.fn(async () => { throw new TypeError("Failed to fetch"); }), productApi)
      .openReview(recommendationId)).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" } satisfies Partial<ProductApiError>);
  });

  it("preserves a 403 as forbidden instead of treating it as an expired login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: false, error: { message: "Forbidden" } }, 403)));
    const api = new HttpDecisionApiClient(authFetch, makeProductStub());

    await expect(api.openReview(recommendationId)).rejects.toMatchObject({ status: 403, message: "Forbidden" });
  });
});
