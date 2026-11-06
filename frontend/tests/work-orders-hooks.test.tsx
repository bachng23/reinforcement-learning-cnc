import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkOrdersClient, WorkOrdersError } from "@/lib/work-orders/client";
import { useWorkOrderRead, useWorkOrderEvents } from "@/lib/work-orders/use-work-orders";
import { clearWorkOrderMemory, useWorkOrderIntent } from "@/lib/work-orders/use-work-order-intent";
import { deferred } from "./product-api-test-utils";
import { eventsExample, workOrderActor, workOrderExample } from "./work-order-fixtures";
import type { WorkOrderCommandRequest } from "@/types/generated/work-orders";

beforeEach(() => clearWorkOrderMemory());
function apiStub() { const api = createWorkOrdersClient(); vi.spyOn(api, "identity").mockResolvedValue(workOrderActor); return api; }

describe("Work Order read isolation and pagination", () => {
  it("cancels old factory requests and never lets stale responses replace the new scope", async () => {
    const api = apiStub();
    const old = deferred<string>();
    const read = vi.fn(async (factory: string) => factory === "A" ? old.promise : "new B data");
    const signals: AbortSignal[] = [];
    const hook = renderHook(({ factory }) => useWorkOrderRead({ api, actor: workOrderActor, scope: factory, read: options => { signals.push(options.signal!); return read(factory); } }), { initialProps: { factory: "A" } });
    hook.rerender({ factory: "B" });
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(hook.result.current.state.data).toBe("new B data"));
    await act(async () => old.resolve("old A data"));
    expect(hook.result.current.state.data).toBe("new B data");
    hook.unmount(); expect(signals.at(-1)?.aborted).toBe(true);
  });
  it("refuses an actor change after a read and drops protected data on access failure", async () => {
    const api = apiStub();
    vi.mocked(api.identity).mockResolvedValue({ ...workOrderActor, id: "different-user" });
    const hook = renderHook(() => useWorkOrderRead({ api, actor: workOrderActor, scope: "factory/order", read: async () => "private report" }));
    await waitFor(() => expect(hook.result.current.state.kind).toBe("error"));
    expect(hook.result.current.state.error?.code).toBe("SESSION_CHANGED");
    expect(hook.result.current.state.data).toBeUndefined();
  });
  it("keeps loading layout with explicitly stale data, then clears it on a forbidden refresh", async () => {
    const api = apiStub();
    const hold = deferred<string>();
    const read = vi.fn().mockResolvedValueOnce("verified").mockReturnValueOnce(hold.promise);
    const hook = renderHook(() => useWorkOrderRead({ api, actor: workOrderActor, scope: "factory/order", read }));
    await waitFor(() => expect(hook.result.current.state.kind).toBe("ready"));
    act(() => hook.result.current.refresh());
    expect(hook.result.current.state.kind).toBe("loading");
    expect(hook.result.current.state.data).toBe("verified");
    await act(async () => hold.reject(new WorkOrdersError(403, "FORBIDDEN")));
    expect(hook.result.current.state.kind).toBe("error");
    expect(hook.result.current.state.data).toBeUndefined();
  });
  it("reads multiple event pages and refreshes all previously loaded pages without duplicates or losing reports", async () => {
    const api = apiStub();
    const events = vi.spyOn(api, "events").mockImplementation(async (_id, after = 0) => eventsExample(after, after < 2));
    const hook = renderHook(({ token }) => useWorkOrderEvents({ api, actor: workOrderActor, id: workOrderExample().data.id, factoryId: "factory-A", refreshToken: token }), { initialProps: { token: "1" } });
    await waitFor(() => expect(hook.result.current.events).toHaveLength(1));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.events).toHaveLength(2));
    expect(hook.result.current.meta?.has_more).toBe(true);
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(hook.result.current.events.map(event => event.sequence)).toEqual([1, 2]);
    expect(hook.result.current.events[1].payload.report?.work_performed).toBe("Attempt 2 inspection");
    hook.rerender({ token: "2" });
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(hook.result.current.events.map(event => event.sequence)).toEqual([1, 2]);
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.events).toHaveLength(3));
    expect(hook.result.current.meta?.has_more).toBe(false);
    expect(events.mock.calls.map(call => call[1])).toEqual([0, 1, 0, 1, 0, 1, 2]);
  });
  it("never relabels the previous factory's events as the new loading scope", async () => {
    const api = apiStub(); const next = deferred<ReturnType<typeof eventsExample>>();
    vi.spyOn(api, "events").mockResolvedValueOnce(eventsExample()).mockReturnValue(next.promise);
    const hook = renderHook(({ factory }) => useWorkOrderEvents({ api, actor: workOrderActor, id: workOrderExample().data.id, factoryId: factory, refreshToken: "read" }), { initialProps: { factory: "A" } });
    await waitFor(() => expect(hook.result.current.events).toHaveLength(1));
    hook.rerender({ factory: "B" });
    expect(hook.result.current.busy).toBe(true);
    expect(hook.result.current.events).toEqual([]);
    expect(hook.result.current.meta).toBeUndefined();
    await act(async () => next.resolve(eventsExample()));
    expect(hook.result.current.events).toHaveLength(1);
  });
});

describe("in-memory, actor-scoped immutable intent recovery", () => {
  const body: WorkOrderCommandRequest = { command: "BLOCK", expected_revision: 7, reason: "Private reason" };
  it("blocks double submit and retries the exact original key/body/revision after network failure", async () => {
    const api = apiStub();
    const first = deferred<string>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce("receipt");
    const accepted = vi.fn();
    const hook = renderHook(() => useWorkOrderIntent({ api, actor: workOrderActor, scope: "command:A:id", send, onAccepted: accepted }));
    act(() => { hook.result.current.start(body); hook.result.current.start(body); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const firstCall = send.mock.calls[0];
    await act(async () => first.reject(new TypeError("Connection lost")));
    expect(hook.result.current.state.kind).toBe("uncertain");
    act(() => hook.result.current.start({ ...body, expected_revision: 9 }));
    expect(send).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.retry());
    await waitFor(() => expect(accepted).toHaveBeenCalledWith("receipt"));
    expect(send.mock.calls[1][0]).toEqual(firstCall[0]);
    expect(send.mock.calls[1][1].key).toBe(firstCall[1].key);
    expect(send.mock.calls[1][0].expected_revision).toBe(7);
    act(() => hook.result.current.reviewed());
    act(() => hook.result.current.start({ ...body, expected_revision: 10 }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2][1].key).not.toBe(firstCall[1].key);
  });
  it("does not rebase or retry a definite 409 until an explicit reviewed new intent", async () => {
    const api = apiStub(); const rejected = vi.fn();
    const send = vi.fn().mockRejectedValue(new WorkOrdersError(409, "WORK_ORDER_REVISION_CONFLICT"));
    const hook = renderHook(() => useWorkOrderIntent({ api, actor: workOrderActor, scope: "conflict", send, onAccepted: vi.fn(), onRejected: rejected }));
    act(() => hook.result.current.start(body));
    await waitFor(() => expect(hook.result.current.state.kind).toBe("rejected"));
    expect(hook.result.current.unresolved).toBe(true);
    act(() => hook.result.current.retry());
    expect(send).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ code: "WORK_ORDER_REVISION_CONFLICT" }));
  });
  it("keeps the original request in RAM across SPA unmount, never writes reports into browser storage", async () => {
    const api = apiStub();
    const local = vi.spyOn(Storage.prototype, "setItem");
    const send = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce("recovered");
    const accepted = vi.fn();
    const mount = () => renderHook(() => useWorkOrderIntent({ api, actor: workOrderActor, scope: "navigation", send, onAccepted: accepted }));
    const first = mount(); act(() => first.result.current.start(body));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = mount();
    expect(second.result.current.state.kind).toBe("uncertain");
    expect(send).toHaveBeenCalledTimes(1); // No POST on mount.
    act(() => second.result.current.retry());
    await waitFor(() => expect(accepted).toHaveBeenCalledWith("recovered"));
    expect(send.mock.calls[1][1].key).toBe(send.mock.calls[0][1].key);
    expect(local).not.toHaveBeenCalled();
  });
  it("keeps a definite rejection rejected after SPA navigation; remount never replays it", async () => {
    const api = apiStub();
    const send = vi.fn().mockRejectedValue(new WorkOrdersError(409, "WORK_ORDER_REVISION_CONFLICT"));
    const mount = () => renderHook(() => useWorkOrderIntent({ api, actor: workOrderActor, scope: "rejected-navigation", send, onAccepted: vi.fn() }));
    const first = mount(); act(() => first.result.current.start(body));
    await waitFor(() => expect(first.result.current.state.kind).toBe("rejected"));
    first.unmount();
    const second = mount();
    expect(second.result.current.state.kind).toBe("rejected");
    act(() => second.result.current.retry());
    expect(send).toHaveBeenCalledTimes(1);
    expect(second.result.current.original).toEqual(body);
  });
  it("does not label a committed receipt as rejected when the post-submit access check fails", async () => {
    const api = apiStub(); vi.mocked(api.identity).mockResolvedValueOnce(workOrderActor).mockRejectedValueOnce(new WorkOrdersError(403, "FORBIDDEN"));
    const send = vi.fn().mockResolvedValue("historical receipt"); const accepted = vi.fn();
    const hook = renderHook(() => useWorkOrderIntent({ api, actor: workOrderActor, scope: "access-after-write", send, onAccepted: accepted }));
    act(() => hook.result.current.start(body));
    await waitFor(() => expect(hook.result.current.state.kind).toBe("uncertain"));
    expect(accepted).not.toHaveBeenCalled(); expect(hook.result.current.original).toEqual(body);
    expect(hook.result.current.unresolved).toBe(true);
  });
  it("discards another user's unresolved body and never exposes or retries it", async () => {
    const api = apiStub(); const send = vi.fn().mockRejectedValue(new TypeError("Offline"));
    const hook = renderHook(({ actor }) => useWorkOrderIntent({ api, actor, scope: "private", send, onAccepted: vi.fn() }), { initialProps: { actor: workOrderActor } });
    act(() => hook.result.current.start(body));
    await waitFor(() => expect(hook.result.current.state.kind).toBe("uncertain"));
    hook.rerender({ actor: { ...workOrderActor, id: "new-user" } });
    expect(hook.result.current.original).toBeUndefined();
    expect(hook.result.current.state.kind).toBe("idle");
    hook.rerender({ actor: workOrderActor });
    expect(hook.result.current.original).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("timeout is an uncertain outcome, not a rejected write or a new intent", async () => {
    const api = apiStub(); const send = vi.fn().mockImplementation(() => new Promise(() => {}));
    const hook = renderHook(() => useWorkOrderIntent({ api, actor: workOrderActor, scope: "timeout", send, onAccepted: vi.fn(), timeoutMs: 15 }));
    act(() => hook.result.current.start(body));
    await waitFor(() => expect(hook.result.current.state.kind).toBe("uncertain"));
    expect(hook.result.current.original).toEqual(body);
    expect(hook.result.current.unresolved).toBe(true);
  });
});
