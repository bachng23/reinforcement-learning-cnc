import {
  OperationsApiError,
  type OperationsApiClient,
  type OperationsRequestOptions,
  type OperationsSnapshotResponse,
  type OperationsCurrentScheduleResponse,
} from "./client";
import { createOperationsDemoFixtures } from "./fixtures";

export type OperationsMockMode = "success" | "empty-schedule" | "unauthorized" | "unavailable";

/** Read-only canonical demo. Decision workflow methods deliberately fail closed. */
export function createMockOperationsApiClient({
  mode = "success",
}: { mode?: OperationsMockMode } = {}): OperationsApiClient {
  function fail(status: number, code: string, message: string): never {
    throw new OperationsApiError(status, {
      schema_version: "3.0", error_id: "mock-error", code, message,
      correlation_id: "mock-request", retryable: status === 503, details: [],
    });
  }

  function check(options?: OperationsRequestOptions) {
    options?.signal?.throwIfAborted();
    if (mode === "unauthorized") fail(401, "UNAUTHORIZED", "Authentication or permission is required");
    if (mode === "unavailable") fail(503, "DB_UNAVAILABLE", "Operations context is unavailable");
  }

  function read(factoryId: string, options?: OperationsRequestOptions) {
    check(options);
    const snapshot = createOperationsDemoFixtures().request.factory_snapshot;
    if (factoryId !== snapshot.factory_id) fail(404, "FACTORY_NOT_FOUND", "Factory was not found");
    if (mode === "empty-schedule") snapshot.current_schedule = null;
    return snapshot;
  }

  async function unsupported(options?: OperationsRequestOptions): Promise<never> {
    check(options);
    return fail(501, "NOT_IMPLEMENTED", "The operations mock supports snapshot and current schedule reads only");
  }

  return {
    async getOperationsSnapshot(factoryId, options): Promise<OperationsSnapshotResponse> {
      const snapshot = read(factoryId, options);
      return {
        factory_id: snapshot.factory_id,
        snapshot_id: snapshot.snapshot_id,
        schema_version: "3.0",
        captured_at: snapshot.captured_at,
        plan_version: snapshot.current_schedule ? 1 : 0,
        current_schedule_id: snapshot.current_schedule?.schedule_id ?? null,
        snapshot,
      };
    },
    async getCurrentSchedule(factoryId, options): Promise<OperationsCurrentScheduleResponse> {
      const snapshot = read(factoryId, options);
      return {
        factory_id: snapshot.factory_id,
        snapshot_id: snapshot.snapshot_id,
        plan_version: snapshot.current_schedule ? 1 : 0,
        schedule: snapshot.current_schedule ?? null,
        basis_snapshot: snapshot.current_schedule ? snapshot : null,
        commit: null,
      };
    },
    getDecisionCase: (_caseId, options) => unsupported(options),
    getDecisionCaseRecommendation: (_caseId, options) => unsupported(options),
    createDecisionCase: (_body, options) => unsupported(options),
    submitDecisionCommand: (_caseId, _body, options) => unsupported(options),
    listEvents: (_caseId, _afterSequence, options) => unsupported(options),
    eventsUrl: () => fail(501, "NOT_IMPLEMENTED", "The operations mock does not provide an event stream"),
  };
}
