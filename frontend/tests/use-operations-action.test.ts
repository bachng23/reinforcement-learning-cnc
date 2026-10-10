import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OperationsApiError, type OperationsWriteOptions } from "@/lib/operations-api/client";
import { useOperationsAction } from "@/lib/operations-api/use-operations-action";
import { deferred } from "@/tests/product-api-test-utils";

describe("operations write recovery journal", () => {
  it("blocks double submit and retries the same immutable key/body after a lost response", async () => {
    const send = vi.fn<(body: { version: number }, options: OperationsWriteOptions) => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Lost response")).mockResolvedValue("accepted");
    const accepted = vi.fn();
    const view = renderHook(() => useOperationsAction({ scope: "decision:case-a", send, onAccepted: accepted }));
    const body = { version: 7 };
    act(() => { view.result.current.start(body); view.result.current.start({ version: 8 }); });
    body.version = 99;
    await waitFor(() => expect(view.result.current.state.kind).toBe("recoverable"));
    expect(send).toHaveBeenCalledTimes(1);
    act(() => view.result.current.recover());
    await waitFor(() => expect(view.result.current.state.kind).toBe("accepted"));
    expect(send.mock.calls[1][0]).toEqual({ version: 7 });
    expect(send.mock.calls[1][1].idempotencyKey).toBe(send.mock.calls[0][1].idempotencyKey);
    expect(accepted).toHaveBeenCalledWith("accepted");
    act(() => view.result.current.acknowledge());
    act(() => view.result.current.start({ version: 8 }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2][1].idempotencyKey).not.toBe(send.mock.calls[1][1].idempotencyKey);
  });

  it("aborts on unmount, keeps the journal and never POSTs automatically on reload", async () => {
    const pending = deferred<string>();
    const send = vi.fn<(body: { command: string }, options: OperationsWriteOptions) => Promise<string>>().mockReturnValue(pending.promise);
    const props = { scope: "real:decision:case-reload", send, onAccepted: vi.fn() };
    const first = renderHook(() => useOperationsAction(props));
    act(() => first.result.current.start({ command: "APPROVE" }));
    expect(send).toHaveBeenCalledTimes(1);
    first.unmount();
    expect(send.mock.calls[0][1].signal?.aborted).toBe(true);
    const second = renderHook(() => useOperationsAction(props));
    await waitFor(() => expect(second.result.current.state.kind).toBe("recoverable"));
    expect(send).toHaveBeenCalledTimes(1);
    send.mockResolvedValue("replayed");
    act(() => second.result.current.recover());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(send.mock.calls[1][1].idempotencyKey).toBe(send.mock.calls[0][1].idempotencyKey);
  });

  it("409 invokes a read/review callback, never changes tokens or automatically resubmits", async () => {
    const send = vi.fn().mockRejectedValue(new OperationsApiError(409, { success: false, error: { code: "PLAN_VERSION_CONFLICT" } }));
    const conflict = vi.fn();
    const view = renderHook(() => useOperationsAction({ scope: "conflict", send, onAccepted: vi.fn(), onConflict: conflict }));
    act(() => view.result.current.start({ expected_plan_version: 0 }));
    await waitFor(() => expect(view.result.current.state.kind).toBe("conflict"));
    expect(conflict).toHaveBeenCalledTimes(1);
    act(() => view.result.current.recover());
    expect(send).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("operations-action:v1:conflict")).toBeNull();
  });

  it.each([401, 403, 503])("preserves the action on HTTP %s for manual recovery", async status => {
    const send = vi.fn().mockRejectedValue(new OperationsApiError(status, null));
    const view = renderHook(() => useOperationsAction({ scope: `status:${status}`, send, onAccepted: vi.fn() }));
    act(() => view.result.current.start({ command: "COMMIT" }));
    await waitFor(() => expect(view.result.current.state.kind).toBe(status === 503 ? "recoverable" : "unauthorized"));
    expect(sessionStorage.getItem(`operations-action:v1:status:${status}`)).toContain("COMMIT");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not replay a retained request under a different signed-in actor", async () => {
    const send = vi.fn().mockRejectedValue(new TypeError("Lost response"));
    const getActorId = vi.fn().mockResolvedValue("operator-a");
    const view = renderHook(() => useOperationsAction({ scope: "real:actor-scope", send, getActorId, onAccepted: vi.fn() }));
    act(() => view.result.current.start({ command: "APPROVE" }));
    await waitFor(() => expect(view.result.current.state.kind).toBe("recoverable"));
    getActorId.mockResolvedValue("operator-b");
    act(() => view.result.current.recover());
    await waitFor(() => expect(view.result.current.state.kind).toBe("unauthorized"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("operations-action:v1:real:actor-scope")).toContain("operator-a");
  });

  it("bounds a hung write, aborts it and retains the original recovery request", async () => {
    const send = vi.fn<(body: { command: string }, options: OperationsWriteOptions) => Promise<string>>().mockReturnValue(deferred<string>().promise);
    const view = renderHook(() => useOperationsAction({ scope: "hung-write", requestTimeoutMs: 15, send, onAccepted: vi.fn() }));
    act(() => view.result.current.start({ command: "COMMIT" }));
    await waitFor(() => expect(view.result.current.state.kind).toBe("recoverable"));
    expect(send.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(sessionStorage.getItem("operations-action:v1:hung-write")).toContain("COMMIT");
  });
});
