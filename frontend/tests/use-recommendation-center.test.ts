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
