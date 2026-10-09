// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import canonical from "../../contracts/v3/fixtures/demo-health-alert.json";
import { createOperationsApiClient, OperationsApiError, type OperationsApiClient, type OperationsCreateDecisionCaseRequest, type OperationsDecisionCommand } from "@/lib/operations-api/client";
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

  it("rejects missing preview cases and unsupported event streams", async () => {
    const mock = createMockOperationsApiClient();
    await expect(mock.getDecisionCase("case")).rejects.toMatchObject({ status: 404 });
    await expect(mock.getDecisionCaseRecommendation("case")).rejects.toMatchObject({ status: 404 });
    await expect(mock.listEvents("case")).rejects.toMatchObject({ status: 501 });
    expect(() => mock.eventsUrl("case")).toThrow(OperationsApiError);
  });
});

describe("canonical preview decision DTOs and receipts", () => {
  it("publishes only on COMMIT and replays historical creation/approval/commit receipts after the head advances", async () => {
    const mock = createMockOperationsApiClient();
    const context = await mock.getOperationsSnapshot(factoryId);
    const before = await mock.getCurrentSchedule(factoryId);
    const body: OperationsCreateDecisionCaseRequest = {
      schema_version: "3.0", factory_id: factoryId, expected_snapshot_id: context.snapshot_id,
      expected_plan_version: context.plan_version,
      request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: "Canonical preview" }, planning_config: { horizon_minutes: 720 } },
    };
    const created = await mock.createDecisionCase(body, { idempotencyKey: "create" });
    const caseId = created.caseStatus.decision_case_id;
    await mock.getDecisionCase(caseId);
    const ready = await mock.getDecisionCase(caseId);
    const artifact = await mock.getDecisionCaseRecommendation(caseId);
    const selected = artifact.recommendation.candidate_plans[1];
    const approvalBody: OperationsDecisionCommand = {
      schema_version: "3.0", decision_case_id: caseId, recommendation_id: artifact.recommendation.recommendation_id,
      expected_snapshot_id: context.snapshot_id, expected_plan_version: context.plan_version,
      expected_case_revision: ready.meta!.case_revision, command: "APPROVE",
      candidate_plan_id: selected.candidate_plan_id, candidate_version: selected.plan_version,
    };
    const approved = await mock.submitDecisionCommand(caseId, approvalBody, { idempotencyKey: "approve" });
    expect(await mock.getCurrentSchedule(factoryId)).toEqual(before);
    const commitBody: OperationsDecisionCommand = { ...approvalBody, command: "COMMIT", expected_case_revision: approved.meta!.case_revision };
    const committed = await mock.submitDecisionCommand(caseId, commitBody, { idempotencyKey: "commit" });
    expect((await mock.getCurrentSchedule(factoryId)).schedule).toEqual(selected.schedule);
    expect(committed.meta?.commit?.plan_version).toBe(context.plan_version + 1);
    expect((await mock.getDecisionCase(caseId)).caseStatus.status).toBe("COMMITTED");
    expect(await mock.createDecisionCase(body, { idempotencyKey: "create" })).toEqual(created);
    expect(await mock.submitDecisionCommand(caseId, approvalBody, { idempotencyKey: "approve" })).toEqual(approved);
    expect(await mock.submitDecisionCommand(caseId, commitBody, { idempotencyKey: "commit" })).toEqual(committed);
    await expect(mock.submitDecisionCommand(caseId, commitBody, { idempotencyKey: "approve" })).rejects.toMatchObject({ status: 409 });
    // Run the persisted DTO through the real HTTP adapter with no package mapping.
    const wire = createOperationsApiClient({ fetcher: async () => Response.json({ success: true, data: committed.caseStatus, meta: committed.meta }) });
    expect(await wire.getDecisionCase(caseId)).toEqual(await mock.getDecisionCase(caseId));
  });
});
