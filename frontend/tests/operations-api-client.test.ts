// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createOperationsApiClient, OperationsApiError } from "@/lib/operations-api/client";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";

describe("operations wire client", () => {
  it("uses shared payloads, cookies, encoded IDs and cancellation", async () => {
    const { request, status } = createOperationsDemoFixtures();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(status)));
    const client = createOperationsApiClient({ fetcher, baseUrl: "https://example.test/api/v1/" });
    const signal = new AbortController().signal;
    expect(await client.createDecisionCase(request, { signal })).toEqual(status);
    expect(fetcher).toHaveBeenLastCalledWith("https://example.test/api/v1/decision-cases", expect.objectContaining({
      method: "POST", credentials: "include", signal, body: JSON.stringify(request),
    }));
    fetcher.mockResolvedValue(new Response(JSON.stringify(status)));
    await client.getDecisionCase("case/a b");
    expect(fetcher.mock.lastCall?.[0]).toBe("https://example.test/api/v1/decision-cases/case%2Fa%20b");
    expect(createOperationsDemoFixtures().request).not.toBe(request);
  });

  it.each(["APPROVE", "REJECT", "MODIFY"] as const)("routes %s with concurrency fields intact", async decision => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const client = createOperationsApiClient({ fetcher, baseUrl: "/api/v1" });
    const body = {
      schema_version: "3.0" as const, decision_case_id: "case-1",
      recommendation_id: "rec-1", expected_snapshot_id: "snapshot-1", decision, note: "Review",
      ...(decision === "REJECT" ? {} : { expected_plan_version: 2, candidate_plan_id: "plan-1" }),
      ...(decision === "MODIFY" ? { modified_schedule: createOperationsDemoFixtures().request.factory_snapshot.current_schedule } : {}),
    };
    await client.submitHumanDecision(body);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/decision-cases/case-1/${decision.toLowerCase()}`, expect.objectContaining({ body: JSON.stringify(body) }));
  });

  it("preserves domain conflicts and non-JSON failures without retrying writes", async () => {
    const payload = { schema_version: "3.0", error_id: "err-1", code: "STALE_SNAPSHOT", message: "Refresh", correlation_id: "corr-1", retryable: false };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status: 409 }));
    const client = createOperationsApiClient({ fetcher });
    await expect(client.runDecisionCase("case-1")).rejects.toMatchObject({ status: 409, contractError: payload });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(client.getDecisionCase("case-1")).rejects.toBeInstanceOf(OperationsApiError);
  });
});
