// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import canonical from "../../contracts/v3/fixtures/demo-health-alert.json";
import { createOperationsApiClient, OperationsApiError, type OperationsApiClient } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";

const factoryId = canonical.factory_snapshot.factory_id;
const methods = ["getOperationsSnapshot", "getCurrentSchedule"] as const;

describe("canonical operations mock / HTTP parity", () => {
  it.each(["success", "empty-schedule"] as const)("returns the same DTOs in %s mode", async mode => {
    const snapshot = structuredClone(canonical.factory_snapshot);
    const schedule = mode === "success" ? snapshot.current_schedule : null;
    const expectedSnapshot = {
      factory_id: factoryId, snapshot_id: snapshot.snapshot_id, schema_version: "3.0",
      captured_at: snapshot.captured_at, plan_version: schedule ? 1 : 0,
      current_schedule_id: schedule?.schedule_id ?? null,
      snapshot: { ...snapshot, current_schedule: schedule },
    };
    const expectedSchedule = {
      factory_id: factoryId, snapshot_id: snapshot.snapshot_id,
      plan_version: schedule ? 1 : 0, schedule, basis_snapshot: schedule ? snapshot : null, commit: null,
    };
    const fetcher = vi.fn<typeof fetch>(async url => {
      const path = new URL(String(url));
      expect(path.searchParams.get("factory_id")).toBe(factoryId);
      const data = path.pathname === "/api/v1/operations/snapshot" ? expectedSnapshot : expectedSchedule;
      return Response.json({ success: true, data });
    });
    const http = createOperationsApiClient({ fetcher, baseUrl: "https://example.test/api/v1" });
    const mock: OperationsApiClient = createMockOperationsApiClient({ mode });
    for (const client of [mock, http]) {
      expect(await client.getOperationsSnapshot(factoryId)).toEqual(expectedSnapshot);
      expect(await client.getCurrentSchedule(factoryId)).toEqual(expectedSchedule);
    }
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/v1/operations/snapshot", "/api/v1/schedules/current",
    ]);
  });

  it.each([
    ["unauthorized", 401, "UNAUTHORIZED", "Authentication or permission is required"],
    ["unavailable", 503, "DB_UNAVAILABLE", "Operations context is unavailable"],
  ] as const)("preserves HTTP error shape in %s mode", async (mode, status, code, message) => {
    const payload = { schema_version: "3.0", error_id: "mock-error", code, message,
      correlation_id: "mock-request", retryable: status === 503, details: [] };
    const http = createOperationsApiClient({ fetcher: async () => Response.json(payload, { status }) });
    const mock = createMockOperationsApiClient({ mode });
    for (const client of [mock, http]) {
      for (const method of methods) {
        await expect(client[method](factoryId)).rejects.toBeInstanceOf(OperationsApiError);
        await expect(client[method](factoryId)).rejects.toMatchObject({ status, payload, contractError: payload });
      }
    }
  });

  it("isolates responses and instances from each other and the shared fixture", async () => {
    const mock = createMockOperationsApiClient();
    const response = await mock.getOperationsSnapshot(factoryId);
    response.snapshot.machines.length = 0;
    response.snapshot.current_schedule!.assignments!.length = 0;
    const schedule = await mock.getCurrentSchedule(factoryId);
    expect(schedule.schedule).toEqual(canonical.factory_snapshot.current_schedule);
    schedule.schedule!.assignments!.length = 0;
    expect((await mock.getOperationsSnapshot(factoryId)).snapshot).toEqual(canonical.factory_snapshot);
    await createMockOperationsApiClient({ mode: "empty-schedule" }).getOperationsSnapshot(factoryId);
    expect((await createMockOperationsApiClient().getOperationsSnapshot(factoryId)).snapshot).toEqual(canonical.factory_snapshot);
  });

  it("rejects unknown factories and honors pre-aborted reads", async () => {
    const mock = createMockOperationsApiClient();
    const controller = new AbortController();
    controller.abort();
    for (const method of methods) {
      await expect(mock[method]("other-factory")).rejects.toMatchObject({ status: 404 });
      await expect(mock[method](factoryId, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    }
  });

  it("fails explicitly for decision workflows outside this mock's scope", async () => {
    const mock = createMockOperationsApiClient();
    await expect(mock.getDecisionCase("case")).rejects.toMatchObject({ status: 501 });
    await expect(mock.getDecisionCaseRecommendation("case")).rejects.toMatchObject({ status: 501 });
    await expect(mock.listEvents("case")).rejects.toMatchObject({ status: 501 });
    await expect(mock.createDecisionCase({ factory_id: factoryId, schema_version: "3.0", expected_snapshot_id: "snapshot", expected_plan_version: 0, request: {} })).rejects.toMatchObject({ status: 501 });
    await expect(mock.submitDecisionCommand("case", { command: "APPROVE", expected_snapshot_id: "snapshot", expected_plan_version: 0, expected_case_revision: 0, candidate_revision: 0 })).rejects.toMatchObject({ status: 501 });
    expect(() => mock.eventsUrl("case")).toThrow(OperationsApiError);
  });
});
