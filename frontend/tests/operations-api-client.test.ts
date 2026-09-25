// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createOperationsApiClient, OperationsApiError } from "@/lib/operations-api/client";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";

describe("operations wire client", () => {
  it("uses shared payloads, envelopes, cookies, encoded IDs and cancellation", async () => {
    const { request, status } = createOperationsDemoFixtures();
    const createBody = {
      factory_id: request.factory_snapshot.factory_id,
      schema_version: "3.0" as const,
      expected_snapshot_id: request.factory_snapshot.snapshot_id,
      expected_plan_version: request.factory_snapshot.current_schedule?.revision ?? 0,
      request: { trigger: request.trigger, planning_config: request.planning_config },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, data: status })));
    const client = createOperationsApiClient({ fetcher, baseUrl: "https://example.test/api/v1/" });
    const signal = new AbortController().signal;
    expect(await client.createDecisionCase(createBody, { signal })).toEqual(status);
    expect(fetcher).toHaveBeenLastCalledWith("https://example.test/api/v1/decision-cases", expect.objectContaining({
      method: "POST", credentials: "include", signal, body: JSON.stringify(createBody),
    }));
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true, data: status })));
    await expect(client.getDecisionCase("case/a b")).resolves.toEqual({ caseStatus: status, meta: undefined });
    expect(fetcher.mock.lastCall?.[0]).toBe("https://example.test/api/v1/decision-cases/case%2Fa%20b");
    expect(createOperationsDemoFixtures().request).not.toBe(request);
  });

  it("reads the recommendation and immutable basis snapshot without reshaping the contract payload", async () => {
    const request = createOperationsDemoFixtures().request;
    const recommendation = {
      schema_version: "3.0" as const,
      recommendation_id: "recommendation-live-1",
      decision_case_id: "case-live-1",
      snapshot_id: request.factory_snapshot.snapshot_id,
      generated_at: "2026-09-25T01:00:00Z",
      recommended_plan_id: "candidate-live-1",
      candidate_plans: [],
      explanation: { summary: "Test", primary_reasons: [], tradeoffs: [], evidence_refs: [] },
    };
    const artifact = { recommendation, snapshot: request.factory_snapshot };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: artifact }));
    const client = createOperationsApiClient({ fetcher, baseUrl: "https://example.test/api/v1" });
    const signal = new AbortController().signal;

    await expect(client.getDecisionCaseRecommendation("case/a b", { signal })).resolves.toEqual(artifact);
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.test/api/v1/decision-cases/case%2Fa%20b/recommendation",
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store", signal }),
    );
  });

  it.each(["APPROVE", "REJECT", "MODIFY", "COMMIT"] as const)("routes %s through the decision command endpoint", async command => {
    const data = { case_id: "case-1", status: command, case_revision: 7, current_context: { snapshot_id: "snapshot-1", plan_version: 2 } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, data })));
    const client = createOperationsApiClient({ fetcher, baseUrl: "/api/v1" });
    const body = {
      command,
      expected_snapshot_id: "snapshot-1",
      expected_plan_version: 2,
      expected_case_revision: 6,
      candidate_revision: 1,
      reason: "Review",
      ...(command === "MODIFY" ? { replacement_schedule: createOperationsDemoFixtures().request.factory_snapshot.current_schedule! } : {}),
    };
    await expect(client.submitDecisionCommand("case-1", body)).resolves.toEqual(data);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/decision-cases/case-1/decision", expect.objectContaining({ body: JSON.stringify(body) }));
  });

  it("preserves domain conflicts, malformed success envelopes and non-JSON failures without retrying writes", async () => {
    const payload = { success: false, error: { code: "STALE_SNAPSHOT", message: "Refresh" }, request_id: "req-1" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status: 409 }));
    const client = createOperationsApiClient({ fetcher });
    await expect(client.getDecisionCase("case-1")).rejects.toMatchObject({ status: 409, apiError: payload.error });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await expect(client.getDecisionCase("case-1")).rejects.toBeInstanceOf(OperationsApiError);
    fetcher.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(client.getDecisionCase("case-1")).rejects.toBeInstanceOf(OperationsApiError);
  });
});
