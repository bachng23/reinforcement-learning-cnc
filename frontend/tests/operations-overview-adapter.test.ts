import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import examples from "../../backend/examples/operations-overview.json";
import httpContract from "../../contracts/v3/operations-http.openapi.json";
import { createOperationsApiClient, OperationsApiError } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { validateOverview, type OperationsOverview } from "@/lib/operations-api/overview";
import { useOperationsOverview } from "@/lib/operations-api/use-operations-overview";
import { deferred } from "./product-api-test-utils";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";

const factoryId = examples.populated.data.context.factory_id;
const fixture = () => structuredClone(examples.populated.data) as OperationsOverview;

describe("Overview Backend contract consumer", () => {
  it("pins the producer OpenAPI examples and transport keys, not a consumer-invented fixture", () => {
    const operation = httpContract.paths["/operations/overview"].get;
    expect(operation.responses["200"].content["application/json"].examples.populated.value).toEqual(examples.populated);
    expect(Object.keys(fixture()).sort()).toEqual([...httpContract.components.schemas.OperationsOverview.required].sort());
    expect(Object.keys(fixture().machines.by_status).sort()).toEqual([...httpContract.components.schemas.OperationsOverview.properties.machines.properties.by_status.required].sort());
  });
  it.each(["populated", "unpublished_missing_health"] as const)("preserves Backend example %s through real HTTP adapter", async name => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(examples[name])));
    const api = createOperationsApiClient({ fetcher, baseUrl: "https://example.test/api/v1" });
    const signal = new AbortController().signal;
    const result = await api.getOperationsOverview(factoryId, { signal });
    expect(result).toEqual(examples[name].data);
    expect(result.provenance.machines.covered).toBe(6);
    expect(result.context.head_revision).toBe(3);
    expect(result.review_preview.items[0].stale).toBe(true);
    expect(result.machines).not.toHaveProperty("health");
    expect(fetcher).toHaveBeenCalledWith(`https://example.test/api/v1/operations/overview?factory_id=${factoryId}`,
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store", signal }));
  });
  it.each([
    [503, examples.unavailable, "OPERATIONS_VALIDATOR_UNAVAILABLE"],
    [403, { success: false, error: { code: "FORBIDDEN", message: "Forbidden" } }, "FORBIDDEN"],
  ])("preserves both deployed error envelopes (%s)", async (status, body, code) => {
    const api = createOperationsApiClient({ fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: status as number })) });
    try { await api.getOperationsOverview(factoryId); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(OperationsApiError);
      const failure = error as OperationsApiError;
      expect(failure.contractError?.code ?? failure.apiError?.code).toBe(code);
    }
  });
  it("rejects missing fields, dishonest counts and inconsistent context", () => {
    expect(() => validateOverview({}, factoryId)).toThrow();
    const bad = fixture(); bad.machines.total++;
    expect(() => validateOverview(bad, factoryId)).toThrow();
    expect(() => validateOverview(fixture(), "other")).toThrow();
    const preview = fixture(); preview.review_preview.items[0].current_context.plan_version++;
    expect(() => validateOverview(preview, factoryId)).toThrow();
  });
  it("mock starts with empty case aggregates, not fabricated review items", async () => {
    const api = createMockOperationsApiClient({ mode: "empty-schedule" });
    const value = await api.getOperationsOverview(factoryId);
    expect(() => validateOverview(value, factoryId)).not.toThrow();
    expect(value.context.publication).toBeNull();
    expect(value.cases.LIVE.total).toBe(0);
    expect(value.review_preview.items).toEqual([]);
  });
  it.each(["unauthorized", "forbidden", "missing-snapshot", "unavailable", "integrity-error"] as const)("explicit mock %s never falls back to success", async mode => {
    const statuses = { unauthorized: 401, forbidden: 403, "missing-snapshot": 404, unavailable: 503, "integrity-error": 500 };
    await expect(createMockOperationsApiClient({ mode }).getOperationsOverview(factoryId)).rejects.toMatchObject({ status: statuses[mode] });
  });
  it("mock aggregates its stored cases and returns independent response copies", async () => {
    const api = createMockOperationsApiClient();
    const basis = await api.getOperationsSnapshot(factoryId);
    const { request } = createOperationsDemoFixtures();
    const trigger = { type: "HEALTH_ALERT" as const, machine_id: request.factory_snapshot.machines[0].machine_id,
      alert_threshold: 0.5, failure_probability: 0.8 };
    const created = await api.createDecisionCase({ factory_id: factoryId, schema_version: "3.0", expected_snapshot_id: basis.snapshot_id,
      expected_plan_version: basis.plan_version, request: { mode: "LIVE", trigger, planning_config: request.planning_config } }, { idempotencyKey: "overview-create" });
    expect((await api.getOperationsOverview(factoryId)).cases.LIVE.by_status.CREATED).toBe(1);
    // Existing explicit demo worker advances on case polling; Overview itself never writes.
    await api.getDecisionCase(created.caseStatus.decision_case_id);
    const first = await api.getOperationsOverview(factoryId);
    validateOverview(first, factoryId);
    expect(first.cases.LIVE.total).toBe(1);
    expect(first.cases.LIVE.by_status.AWAITING_APPROVAL).toBe(1);
    const list = await api.listDecisionCases({ factory_id: factoryId });
    expect(first.review_preview.items).toEqual(list.data);
    first.review_preview.items.length = 0;
    expect((await api.getOperationsOverview(factoryId)).review_preview.items).toHaveLength(1);
  });
});

describe("Overview hook scope and cancellation", () => {
  it("does not read a missing factory", () => {
    const api = { getOperationsOverview: vi.fn() };
    const { result } = renderHook(() => useOperationsOverview({ api, factoryId: " " }));
    expect(result.current.state.kind).toBe("missing-factory");
    expect(api.getOperationsOverview).not.toHaveBeenCalled();
  });
  it("retry is a single GET and preserves unpublished/missing-measurement data without inventing KPIs", async () => {
    const api = { getOperationsOverview: vi.fn().mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValue(examples.unpublished_missing_health.data) };
    const { result } = renderHook(() => useOperationsOverview({ api, factoryId }));
    await waitFor(() => expect(result.current.state.kind).toBe("network-error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(result.current.state.data?.context.publication).toBeNull();
    expect(result.current.state.data?.machines).not.toHaveProperty("health");
    expect(api.getOperationsOverview).toHaveBeenCalledTimes(2);
  });
  it("hides old factory immediately, aborts and ignores late A after B", async () => {
    const old = deferred<OperationsOverview>();
    const signals: AbortSignal[] = [];
    const api = { getOperationsOverview: vi.fn(async (id: string, options?: { signal?: AbortSignal }) => {
      signals.push(options!.signal!);
      return id === "old" ? old.promise : fixture();
    }) };
    const { result, rerender, unmount } = renderHook(({ id }) => useOperationsOverview({ api, factoryId: id }), { initialProps: { id: "old" } });
    rerender({ id: factoryId });
    expect(result.current.state.data).toBeNull();
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(signals[0].aborted).toBe(true);
    await act(async () => old.resolve({ ...fixture(), context: { ...fixture().context, factory_id: "old" } }));
    expect(result.current.state.data?.context.factory_id).toBe(factoryId);
    unmount(); expect(signals[1].aborted).toBe(true);
  });
  it("latest refresh wins without timers or mutation retries", async () => {
    const first = deferred<OperationsOverview>();
    const second = deferred<OperationsOverview>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const api = { getOperationsOverview: read };
    const { result } = renderHook(() => useOperationsOverview({ api, factoryId }));
    act(() => result.current.refresh());
    expect(read.mock.calls[0][1].signal.aborted).toBe(true);
    const latest = fixture(); latest.context.head_revision = 8;
    await act(async () => second.resolve(latest));
    await act(async () => first.resolve(fixture()));
    expect(result.current.state.data?.context.head_revision).toBe(8);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it.each([
    [401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [503, "unavailable"], [500, "integrity-error"],
  ])("keeps HTTP %s distinct as %s without fallback", async (status, kind) => {
    const api = { getOperationsOverview: vi.fn().mockRejectedValue(new OperationsApiError(status as number,
      { success: false, error: { code: "OPERATIONS_INTEGRITY_ERROR" } })) };
    const { result } = renderHook(() => useOperationsOverview({ api, factoryId }));
    await waitFor(() => expect(result.current.state.kind).toBe(kind));
    expect(result.current.state.data).toBeNull();
    expect(api.getOperationsOverview).toHaveBeenCalledTimes(1);
  });
  it.each(["mismatch", "missing", "network"])("classifies %s responses", async scenario => {
    const value = fixture(); value.context.factory_id = "wrong";
    const api = { getOperationsOverview: vi.fn().mockImplementation(async () => {
      if (scenario === "network") throw new TypeError("connection refused");
      return scenario === "missing" ? {} as OperationsOverview : value;
    }) };
    const { result } = renderHook(() => useOperationsOverview({ api, factoryId }));
    await waitFor(() => expect(result.current.state.kind).toBe(scenario === "mismatch" ? "context-mismatch" : scenario === "missing" ? "integrity-error" : "network-error"));
    expect(result.current.state.data).toBeNull();
  });
});
