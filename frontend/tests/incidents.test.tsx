import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IncidentMutationForm, CommandForm } from "@/components/incidents/incident-forms";
import { useIncidentRead } from "@/lib/incidents/use-incident-read";
import { OperationsApiError } from "@/lib/operations-api/client";
import type { Detail, Envelope, Mutation } from "@/lib/incidents/client";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), detail: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/incidents/client", async original => ({ ...await original<typeof import("@/lib/incidents/client")>(), mutate: mocks.mutate, detail: mocks.detail }));
vi.mock("@/lib/operations-api/actor", () => ({ getOperationsActorId: mocks.actor }));
const result = { success: true, data: { incident: { id: "incident-a", factory_id: "factory-a", revision: 4 } } } as Envelope<Detail>;
const command: Mutation = { operation: "command", body: { command: "ACKNOWLEDGE", expected_revision: 3 } };
beforeEach(() => {
  sessionStorage.clear();
  mocks.actor.mockResolvedValue("owner-a");
  mocks.detail.mockResolvedValue(result);
  mocks.mutate.mockReset();
});
function Form({ saved = vi.fn() }: { saved?: (id: string) => void }) {
  return <IncidentMutationForm factoryId="factory-a" id="incident-a" build={() => command} onSaved={saved}><input aria-label="Test note" /></IncidentMutationForm>;
}
function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Review action" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
}
describe("Incident command recovery UI", () => {
  it("retries the same body/key after a committed response is lost and blocks duplicate input", async () => {
    const saved = vi.fn();
    mocks.mutate.mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValue(result);
    render(<Form saved={saved} />);
    confirm();
    await screen.findByRole("button", { name: "Recover original request" });
    expect(screen.getByRole("button", { name: "Review action" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Recover original request" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("incident-a"));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate.mock.calls[1][2]).toEqual(command);
    expect(mocks.mutate.mock.calls[0][3].idempotencyKey).toBe(mocks.mutate.mock.calls[1][3].idempotencyKey);
  });
  it("reload recovers manually without generating another key or submitting on mount", async () => {
    mocks.mutate.mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValue(result);
    const first = render(<Form />);
    confirm();
    await screen.findByRole("button", { name: "Recover original request" });
    const key = mocks.mutate.mock.calls[0][3].idempotencyKey;
    first.unmount();
    render(<Form />);
    await screen.findByRole("button", { name: "Recover original request" });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Recover original request" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    expect(mocks.mutate.mock.calls[1][3].idempotencyKey).toBe(key);
  });
  it("stale revision is not retried or replaced without review", async () => {
    mocks.mutate.mockRejectedValue(new OperationsApiError(409, { success: false, error: { code: "INCIDENT_REVISION_CONFLICT" } }));
    const saved = vi.fn();
    render(<Form saved={saved} />);
    confirm();
    await screen.findByRole("button", { name: "Refresh and review" });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Recover original request" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh and review" }));
    expect(saved).toHaveBeenCalledWith("incident-a");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("confirmation pins the reviewed body when the incoming revision changes", async () => {
    const data = { incident: { id: "incident-a", factory_id: "factory-a", revision: 3 }, available_commands: ["ACKNOWLEDGE"], links: [] } as unknown as Detail;
    const view = render(<CommandForm data={data} manager={false} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review action" }));
    view.rerender(<CommandForm data={{ ...data, incident: { ...data.incident, revision: 4 } }} manager={false} onSaved={vi.fn()} />);
    mocks.mutate.mockResolvedValue(result);
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    expect(mocks.mutate.mock.calls[0][2].body.expected_revision).toBe(3);
  });
});
it("late scope responses never appear in another factory, even when abort is ignored", async () => {
  let resolveOld!: (value: string) => void;
  const pending = new Promise<string>(resolve => { resolveOld = resolve; });
  const view = renderHook(({ factory }) => useIncidentRead(factory, async () => factory === "A" ? pending : "B record"), { initialProps: { factory: "A" } });
  view.rerender({ factory: "B" });
  await waitFor(() => expect(view.result.current.data).toBe("B record"));
  await act(async () => resolveOld("A record"));
  expect(view.result.current.data).toBe("B record");
});
