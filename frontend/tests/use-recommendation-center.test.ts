import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  RecommendationCenterData,
  RecommendationCenterDataSource,
} from "@/lib/recommendation-center/data-source";
import { useRecommendationCenter } from "@/lib/recommendation-center/use-recommendation-center";
import { deferred } from "@/tests/product-api-test-utils";

function pendingSource(read: RecommendationCenterDataSource["read"]): RecommendationCenterDataSource {
  return { mode: "real", read };
}

function realData(
  status: "CREATED" | "ANALYZING" | "GENERATING" | "VALIDATING" | "EXPLAINING" | "AWAITING_APPROVAL" | "FAILED",
  attempt: number,
): RecommendationCenterData {
  return {
    source: "real",
    artifactState: status === "FAILED" ? "blocked" : "pending",
    recommendation: null,
    snapshot: null,
    caseStatus: {
      schema_version: "3.0",
      decision_case_id: "case-real",
      mode: "LIVE",
      status,
      snapshot_id: "snapshot-real",
      recommendation_id: status === "AWAITING_APPROVAL" ? "recommendation-real" : null,
      created_at: "2026-09-25T00:00:00Z",
      updated_at: "2026-09-25T00:01:00Z",
      error_code: status === "FAILED" ? "NO_FEASIBLE_PLAN" : null,
    },
    caseMeta: {
      factory_id: "factory-real",
      base_plan_version: 2,
      case_revision: attempt + 1,
      current_context: { snapshot_id: "snapshot-real", plan_version: 2 },
      stale: false,
      processing: {
        status: status === "CREATED" ? "PENDING" : status === "FAILED" ? "FAILED" : status === "AWAITING_APPROVAL" ? "SUCCEEDED" : "RUNNING",
        attempt,
        error_code: status === "FAILED" ? "NO_FEASIBLE_PLAN" : null,
      },
    },
  };
}

describe("useRecommendationCenter", () => {
  it("does not call the data source without a case ID", async () => {
    const read = vi.fn<RecommendationCenterDataSource["read"]>();
    const source = pendingSource(read);
    const { result } = renderHook(() => useRecommendationCenter({
      dataSource: source,
    }));

    await waitFor(() => expect(result.current.state.kind).toBe("missing-case-id"));
    expect(read).not.toHaveBeenCalled();
  });

  it("polls running stages in order and stops at AWAITING_APPROVAL", async () => {
    const responses = [
      realData("CREATED", 0),
      realData("ANALYZING", 1),
      realData("GENERATING", 1),
      realData("VALIDATING", 1),
      realData("EXPLAINING", 1),
      realData("AWAITING_APPROVAL", 1),
    ];
    const read = vi.fn<RecommendationCenterDataSource["read"]>(async () => responses.shift() ?? realData("AWAITING_APPROVAL", 1));
    const source = pendingSource(read);
    const view = renderHook(() => useRecommendationCenter({ dataSource: source, caseId: "case-real", pollIntervalMs: 5 }));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(6));
    await waitFor(() => expect(view.result.current.state).toMatchObject({
      kind: "ready",
      data: { caseStatus: { status: "AWAITING_APPROVAL" } },
    }));
    expect(view.result.current.polling).toBe(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(read).toHaveBeenCalledTimes(6);
  });

  it("stops polling when the backend reports a blocked failure", async () => {
    const responses = [realData("GENERATING", 2), realData("FAILED", 2)];
    const read = vi.fn<RecommendationCenterDataSource["read"]>(async () => responses.shift() ?? realData("FAILED", 2));
    const source = pendingSource(read);
    const view = renderHook(() => useRecommendationCenter({ dataSource: source, caseId: "case-real", pollIntervalMs: 5 }));

    await waitFor(() => expect(view.result.current.state).toMatchObject({
      kind: "ready",
      data: { artifactState: "blocked", caseStatus: { error_code: "NO_FEASIBLE_PLAN" } },
    }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.result.current.polling).toBe(false);
  });

  it("stops polling when a running response fails closed on an identifier mismatch", async () => {
    const running = realData("GENERATING", 2);
    if (running.source !== "real") throw new Error("Expected live test data.");
    const mismatch: RecommendationCenterData = {
      ...running,
      artifactState: "mismatch",
      recommendation: null,
      snapshot: null,
      message: "Recommendation reference does not match the case.",
    };
    const read = vi.fn<RecommendationCenterDataSource["read"]>().mockResolvedValue(mismatch);
    const source = pendingSource(read);
    const view = renderHook(() => useRecommendationCenter({
      dataSource: source,
      caseId: "case-real",
      pollIntervalMs: 5,
    }));

    await waitFor(() => expect(view.result.current.state).toMatchObject({
      kind: "ready",
      data: { artifactState: "mismatch" },
    }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(view.result.current.polling).toBe(false);
  });

  it("aborts the old request on retry and the active request on unmount", async () => {
    const requests = [deferred<RecommendationCenterData>(), deferred<RecommendationCenterData>()];
    const signals: AbortSignal[] = [];
    const read = vi.fn<RecommendationCenterDataSource["read"]>((_caseId, options) => {
      if (!options?.signal) throw new Error("AbortSignal is required.");
      signals.push(options.signal);
      return requests[signals.length - 1].promise;
    });
    const source = pendingSource(read);
    const view = renderHook(() => useRecommendationCenter({ dataSource: source, caseId: "case-real" }));

    await waitFor(() => expect(signals).toHaveLength(1));
    act(() => view.result.current.retry());
    await waitFor(() => expect(signals).toHaveLength(2));

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    view.unmount();
    expect(signals[1].aborted).toBe(true);
  });
});
