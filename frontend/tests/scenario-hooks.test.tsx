import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScenarioClient,
  ScenarioError,
} from "@/lib/scenario-planning/client";
import {
  clearScenarioMemory,
  useScenarioIntent,
  useScenarioRead,
  useUnsavedScenario,
} from "@/lib/scenario-planning/hooks";
import { deferred } from "./product-api-test-utils";
import { scenarioActor, scenarioJob } from "./scenario-fixtures";
beforeEach(() => clearScenarioMemory());
afterEach(() => vi.useRealTimers());
function apiStub() {
  const api = createScenarioClient();
  vi.spyOn(api, "identity").mockResolvedValue(scenarioActor);
  return api;
}

describe("Scenario read lifecycle", () => {
  it("disabling a dependent read aborts and clears its previous scoped data", async () => {
    const api = apiStub();
    const read = vi.fn().mockResolvedValue("saved source entities");
    const hook = renderHook(
      ({ enabled }) =>
        useScenarioRead({
          api,
          actor: scenarioActor,
          scope: "entities",
          read,
          enabled,
        }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() =>
      expect(hook.result.current.data).toBe("saved source entities"),
    );
    const signal = read.mock.calls[0][0].signal;
    hook.rerender({ enabled: false });
    expect(signal.aborted).toBe(true);
    expect(hook.result.current.data).toBeUndefined();
    act(() => hook.result.current.refresh());
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("aborts old factory reads and drops late responses without flashing old data", async () => {
    const api = apiStub();
    const old = deferred<string>();
    const signals: AbortSignal[] = [];
    const hook = renderHook(
      ({ scope }) =>
        useScenarioRead({
          api,
          actor: scenarioActor,
          scope,
          read: (options) => {
            signals.push(options.signal!);
            return scope === "F1"
              ? old.promise
              : Promise.resolve("verified F2");
          },
        }),
      { initialProps: { scope: "F1" } },
    );
    hook.rerender({ scope: "F2" });
    expect(signals[0].aborted).toBe(true);
    expect(hook.result.current.data).toBeUndefined();
    await waitFor(() => expect(hook.result.current.data).toBe("verified F2"));
    await act(async () => old.resolve("private F1"));
    expect(hook.result.current.data).toBe("verified F2");
    hook.unmount();
    expect(signals.at(-1)?.aborted).toBe(true);
  });
  it("polls pending statuses with backoff and stops at terminal or unmount, never writes", async () => {
    vi.useFakeTimers();
    const api = apiStub();
    const read = vi
      .fn()
      .mockResolvedValueOnce(scenarioJob("QUEUED"))
      .mockResolvedValueOnce(scenarioJob("RUNNING"))
      .mockResolvedValue(scenarioJob("SUCCEEDED"));
    const hook = renderHook(() =>
      useScenarioRead<ReturnType<typeof scenarioJob>>({
        api,
        actor: scenarioActor,
        scope: "job",
        read,
        polling: (job) => ["QUEUED", "RUNNING"].includes(job.status),
      }),
    );
    await act(async () => {});
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(read).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(read).toHaveBeenCalledTimes(3);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry errors infinitely; explicit retry re-reads and authorization clears data", async () => {
    const api = apiStub();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce("current read")
      .mockRejectedValueOnce(new ScenarioError(403, "FORBIDDEN"));
    const hook = renderHook(() =>
      useScenarioRead({ api, actor: scenarioActor, scope: "workspace", read }),
    );
    await waitFor(() => expect(hook.result.current.kind).toBe("error"));
    expect(read).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.data).toBe("current read"));
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.kind).toBe("error"));
    expect(hook.result.current.data).toBeUndefined();
  });
  it("fences a changed actor after a successful transport read", async () => {
    const api = apiStub();
    vi.mocked(api.identity).mockResolvedValue({
      ...scenarioActor,
      id: "other-user",
    });
    const hook = renderHook(() =>
      useScenarioRead({
        api,
        actor: scenarioActor,
        scope: "private",
        read: async () => "private",
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.error?.code).toBe("SESSION_CHANGED"),
    );
    expect(hook.result.current.data).toBeUndefined();
  });
});

it("warns before discarding a draft, while section and result selection keep the same editor", () => {
  const previous = location.href;
  history.replaceState(
    null,
    "",
    "/operations/scenarios/one?factory_id=F&scenario_id=D",
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const hook = renderHook(() => useUnsavedScenario(true));
  const anchor = document.createElement("a");
  anchor.addEventListener("click", (event) => event.preventDefault());
  document.body.append(anchor);
  try {
    anchor.href = "#scenario-runs";
    anchor.click();
    anchor.href =
      "/operations/scenarios/one?factory_id=F&scenario_id=D&run_id=R";
    anchor.click();
    expect(confirm).not.toHaveBeenCalled();
    anchor.href = "/operations/scenarios/one?factory_id=F&scenario_id=another";
    anchor.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);
  } finally {
    hook.unmount();
    anchor.remove();
    confirm.mockRestore();
    history.replaceState(null, "", previous);
  }
});

describe("Scenario immutable intent recovery", () => {
  const body = { expected_revision: 2, note: "Keep exact user intent" };
  it("prevents double submit and retains exact body/key/revision after a lost response", async () => {
    const api = apiStub();
    const first = deferred<string>();
    const accepted = vi.fn();
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce("verified read");
    const hook = renderHook(() =>
      useScenarioIntent({
        api,
        actor: scenarioActor,
        scope: "save:F1:D1",
        send,
        onAccepted: accepted,
      }),
    );
    act(() => {
      hook.result.current.start(body);
      hook.result.current.start(body);
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await act(async () => first.reject(new TypeError("lost")));
    expect(hook.result.current.state.kind).toBe("uncertain");
    act(() => hook.result.current.start({ ...body, expected_revision: 9 }));
    expect(send).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.retry());
    await waitFor(() => expect(accepted).toHaveBeenCalledWith("verified read"));
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(send.mock.calls[1][1].key).toBe(send.mock.calls[0][1].key);
  });
  it("409 requires explicit review and a new key; no auto revision update", async () => {
    const api = apiStub();
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new ScenarioError(409, "SCENARIO_REVISION_CONFLICT"),
      )
      .mockResolvedValueOnce("ok");
    const hook = renderHook(() =>
      useScenarioIntent({
        api,
        actor: scenarioActor,
        scope: "conflict",
        send,
        onAccepted: vi.fn(),
      }),
    );
    act(() => hook.result.current.start(body));
    await waitFor(() =>
      expect(hook.result.current.state.kind).toBe("rejected"),
    );
    act(() => hook.result.current.retry());
    expect(send).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.reviewed());
    act(() => hook.result.current.start({ ...body, expected_revision: 5 }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[0][0].expected_revision).toBe(2);
    expect(send.mock.calls[1][0].expected_revision).toBe(5);
    expect(send.mock.calls[1][1].key).not.toBe(send.mock.calls[0][1].key);
  });
  it("SPA remount recovers RAM intent without auto POST or sensitive browser persistence", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const api = apiStub();
    const send = vi.fn().mockImplementation(() => new Promise(() => {}));
    const mount = () =>
      renderHook(() =>
        useScenarioIntent({
          api,
          actor: scenarioActor,
          scope: "resume",
          send,
          onAccepted: vi.fn(),
        }),
      );
    const first = mount();
    act(() => first.result.current.start(body));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = mount();
    expect(second.result.current.state.kind).toBe("uncertain");
    expect(second.result.current.original).toEqual(body);
    expect(send).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
  });
  it("clears a different actor's uncertain body", async () => {
    const api = apiStub();
    const send = vi.fn().mockRejectedValue(new TypeError("lost"));
    const hook = renderHook(
      ({ actor }) =>
        useScenarioIntent({
          api,
          actor,
          scope: "private",
          send,
          onAccepted: vi.fn(),
        }),
      { initialProps: { actor: scenarioActor } },
    );
    act(() => hook.result.current.start(body));
    await waitFor(() =>
      expect(hook.result.current.state.kind).toBe("uncertain"),
    );
    hook.rerender({ actor: { ...scenarioActor, id: "new-user" } });
    expect(hook.result.current.original).toBeUndefined();
    expect(hook.result.current.state.kind).toBe("idle");
  });
});
