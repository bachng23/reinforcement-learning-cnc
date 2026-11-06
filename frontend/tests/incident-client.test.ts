import { beforeEach, expect, it, vi } from "vitest";
import { detail, incidentRequest, list, mutate } from "@/lib/incidents/client";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ authFetch: request, endpoint: (path: string) => path }));
const incident = { id: "incident-a", factory_id: "factory-a", revision: 1, status: "OPEN" };
const envelope = (data: unknown) => ({ success: true, data, meta: { read_at: "2026-10-24T00:00:00Z" } });
beforeEach(() => request.mockReset());
it("encodes scope and filters, reads no-store and never falls back on failure", async () => {
  request.mockResolvedValue(new Response(JSON.stringify(envelope([incident]))));
  await list({ factory_id: "factory-a", q: "alarm & drift" });
  expect(request.mock.calls[0][0]).toContain("q=alarm+%26+drift");
  expect(request.mock.calls[0][1].cache).toBe("no-store");
  request.mockResolvedValue(new Response("outage", { status: 503 }));
  await expect(list({ factory_id: "factory-a" })).rejects.toMatchObject({ status: 502 });
});
it("rejects cross-factory and wrong-identity detail responses", async () => {
  request.mockResolvedValue(new Response(JSON.stringify(envelope({ incident }))));
  await expect(detail("incident-a", "factory-b")).rejects.toMatchObject({ status: 502 });
  request.mockResolvedValue(new Response(JSON.stringify(envelope({ incident }))));
  await expect(detail("other", "factory-a")).rejects.toMatchObject({ status: 502 });
});
it("forwards DELETE body, revision and idempotency key without rewriting", async () => {
  request.mockResolvedValue(new Response(JSON.stringify(envelope({ incident }))));
  const body = { expected_revision: 7, reason: "Incorrect association" };
  await mutate("incident-a", "factory-a", { operation: "unlink", linkId: "link-a", body }, { idempotencyKey: "original-key" });
  expect(request.mock.calls[0][1]).toMatchObject({ method: "DELETE", body: JSON.stringify(body), headers: { "Idempotency-Key": "original-key" } });
});
it("HTTP 200 without a valid envelope is not success", async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ success: true })));
  await expect(incidentRequest("/incidents")).rejects.toMatchObject({ status: 502 });
});
