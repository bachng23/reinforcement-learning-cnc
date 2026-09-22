import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OperationsApiError } from "@/lib/operations-api/client";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { useOperationsContext } from "@/lib/operations-api/use-operations-context";
import { deferred } from "@/tests/product-api-test-utils";

const factoryId = createOperationsDemoFixtures().request.factory_snapshot.factory_id;

function apiFailure(status: number, message: string) {
  return new OperationsApiError(status, {
    schema_version: "3.0",
    error_id: `error-${status}`,
    code: `STATUS_${status}`,
    message,
    correlation_id: `request-${status}`,
    retryable: status === 503,
    details: [],
  });
}

describe("useOperationsContext", () => {
  it("reads snapshot and schedule together with one abort signal", async () => {
    const api = createMockOperationsApiClient();
    const getSnapshot = vi.spyOn(api, "getOperationsSnapshot");
    const getSchedule = vi.spyOn(api, "getCurrentSchedule");
    const view = renderHook(() => useOperationsContext({ api, factoryId }));

    await waitFor(() => expect(view.result.current.state.kind).toBe("ready"));

    const snapshotSignal = getSnapshot.mock.calls[0][1]?.signal;
    const scheduleSignal = getSchedule.mock.calls[0][1]?.signal;
    expect(snapshotSignal).toBeInstanceOf(AbortSignal);
    expect(scheduleSignal).toBe(snapshotSignal);
    expect(snapshotSignal?.aborted).toBe(false);

    view.unmount();
    expect(snapshotSignal?.aborted).toBe(true);
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps HTTP %s to %s", async (status, expectedKind) => {
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getOperationsSnapshot").mockRejectedValue(apiFailure(status, `Status ${status}`));

    const { result } = renderHook(() => useOperationsContext({ api, factoryId }));

    await waitFor(() => expect(result.current.state.kind).toBe(expectedKind));
  });

  it("separates network failures from API failures", async () => {
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getOperationsSnapshot").mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useOperationsContext({ api, factoryId }));

    await waitFor(() => expect(result.current.state).toEqual({
      kind: "network-error",
      message: "Network error: Failed to fetch",
    }));
  });

  it("retries both reads after an error", async () => {
    const api = createMockOperationsApiClient();
    const readSnapshot = api.getOperationsSnapshot.bind(api);
    const getSnapshot = vi.spyOn(api, "getOperationsSnapshot")
      .mockRejectedValueOnce(apiFailure(503, "Temporarily unavailable"))
      .mockImplementation(readSnapshot);
    const getSchedule = vi.spyOn(api, "getCurrentSchedule");
    const { result } = renderHook(() => useOperationsContext({ api, factoryId }));

    await waitFor(() => expect(result.current.state.kind).toBe("unavailable"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(getSchedule).toHaveBeenCalledTimes(2);
  });

  it("aborts the stale request before retrying and aborts the active request on unmount", async () => {
    const api = createMockOperationsApiClient();
    const snapshotReads = [deferred<never>(), deferred<never>()];
    const scheduleReads = [deferred<never>(), deferred<never>()];
    const snapshotSignals: AbortSignal[] = [];
    const scheduleSignals: AbortSignal[] = [];
    vi.spyOn(api, "getOperationsSnapshot").mockImplementation((_factoryId, options) => {
      snapshotSignals.push(options?.signal as AbortSignal);
      return snapshotReads[snapshotSignals.length - 1].promise;
    });
    vi.spyOn(api, "getCurrentSchedule").mockImplementation((_factoryId, options) => {
      scheduleSignals.push(options?.signal as AbortSignal);
      return scheduleReads[scheduleSignals.length - 1].promise;
    });
    const view = renderHook(() => useOperationsContext({ api, factoryId }));

    await waitFor(() => expect(snapshotSignals).toHaveLength(1));
    act(() => view.result.current.retry());
    await waitFor(() => expect(snapshotSignals).toHaveLength(2));

    expect(snapshotSignals[0].aborted).toBe(true);
    expect(scheduleSignals[0].aborted).toBe(true);
    expect(snapshotSignals[1].aborted).toBe(false);
    expect(scheduleSignals[1].aborted).toBe(false);

    view.unmount();
    expect(snapshotSignals[1].aborted).toBe(true);
    expect(scheduleSignals[1].aborted).toBe(true);
  });

  it("rejects a snapshot and schedule version mismatch", async () => {
    const api = createMockOperationsApiClient();
    const readSchedule = api.getCurrentSchedule.bind(api);
    vi.spyOn(api, "getCurrentSchedule").mockImplementation(async (...args) => {
      const response = await readSchedule(...args);
      return { ...response, plan_version: response.plan_version + 1 };
    });
    const { result } = renderHook(() => useOperationsContext({ api, factoryId }));

    await waitFor(() => expect(result.current.state.kind).toBe("mismatch"));
    expect(result.current.state).toMatchObject({
      message: expect.stringContaining("consistent operations context"),
    });
  });
});
