import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkOrderActions } from "@/components/work-orders/work-order-actions";
import { createWorkOrdersClient, WorkOrdersError } from "@/lib/work-orders/client";
import { clearWorkOrderMemory } from "@/lib/work-orders/use-work-order-intent";
import { workOrderActor, workOrderExample } from "./work-order-fixtures";
import type { CommandName } from "@/lib/work-orders/commands";
beforeEach(() => clearWorkOrderMemory());
function setup(command: CommandName, options = false) {
  const api = createWorkOrdersClient(); vi.spyOn(api, "identity").mockResolvedValue(workOrderActor);
  const response = workOrderExample(); response.data.available_commands = [command]; response.data.revision = 7;
  const submit = vi.spyOn(api, "command").mockResolvedValue(response);
  const refresh = vi.fn();
  const props = { api, actor: workOrderActor, response, fresh: true, refresh,
    ...(options ? { assigneeOptions: [{ user_id: "b0000000-0000-4000-8000-000000000002", username: "Eligible fixture operator" }] } : {}) };
  const view = render(<WorkOrderActions {...props} />);
  return { api, response, submit, refresh, props, view };
}
describe("available-command forms, not a parallel lifecycle", () => {
  it.each([["ACCEPT", "Accept work"], ["START", "Start work"]] as const)("%s does not add a redundant confirmation modal", async (command, name) => {
    const { submit } = setup(command);
    await userEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toEqual({ command, expected_revision: 7 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each([["BLOCK", "Report blocker"], ["RESUME", "Resume work"], ["REQUEST_REWORK", "Request rework"], ["CANCEL", "Cancel work order"], ["MANAGER_HOLD", "Manager hold"]] as const)("%s sends an explicit reason without caller actor/time or impersonation", async (command, name) => {
    const user = userEvent.setup(); const { submit } = setup(command);
    await user.click(screen.getByRole("button", { name }));
    const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByLabelText("Reason"), "  Reviewed actual situation  ");
    await user.click(dialog.getByRole("button", { name: `Confirm ${name.toLowerCase()}` }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toEqual({ command, expected_revision: 7, reason: "Reviewed actual situation" });
  });
  it.each([["ASSIGN", "Assign"], ["REASSIGN", "Reassign"], ["REASSIGN_FOR_REWORK", "Reassign for rework"]] as const)("%s requires picker data, never a production UUID workaround", async (command, name) => {
    const user = userEvent.setup(); const { submit, view } = setup(command);
    expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Eligible assignees");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    view.unmount();
    clearWorkOrderMemory();
    const testOnly = setup(command, true);
    await user.click(screen.getByRole("button", { name }));
    await user.selectOptions(screen.getByLabelText("Eligible assignee"), "b0000000-0000-4000-8000-000000000002");
    if (command !== "ASSIGN") await user.type(screen.getByLabelText("Reason"), "Independent handover review");
    await user.click(screen.getByRole("button", { name: `Confirm ${name.toLowerCase()}` }));
    await waitFor(() => expect(testOnly.submit).toHaveBeenCalledTimes(1));
    expect(testOnly.submit.mock.calls[0][1]).toMatchObject({ command, expected_revision: 7, assignee_user_id: "b0000000-0000-4000-8000-000000000002" });
    expect(submit).not.toHaveBeenCalled();
  });
  it("validates STOPPED, freezes the report and prevents duplicate pending submit", async () => {
    const user = userEvent.setup(); const { submit } = setup("COMPLETE");
    submit.mockImplementation(() => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Report completion" }));
    await user.selectOptions(screen.getByLabelText("Outcome"), "STOPPED");
    await user.type(screen.getByLabelText("Work performed"), "Inspected tool");
    await user.type(screen.getByLabelText("Result"), "Stopped safely");
    await user.click(screen.getByRole("button", { name: "Confirm report completion" }));
    expect(submit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Stop reason (required)"), "Unsafe access");
    await user.dblClick(screen.getByRole("button", { name: "Confirm report completion" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Work performed")).toBeDisabled();
    expect(submit.mock.calls[0][1]).toEqual({ command: "COMPLETE", expected_revision: 7, report: { outcome: "STOPPED", work_performed: "Inspected tool", result: "Stopped safely", stop_reason: "Unsafe access" } });
  });
  it("requires independent STOPPED verification and does not expose self-verification", async () => {
    const user = userEvent.setup(); const { props, view, submit } = setup("CLOSE");
    const response = workOrderExample(); response.data.available_commands = ["CLOSE"]; response.data.revision = 7;
    response.data.latest_completion = { actor_id: workOrderActor.id, attempt: 1, completed_at: response.meta.read_at, report: { outcome: "STOPPED", work_performed: "Reported work", result: "Stopped", stop_reason: "Safety" } };
    view.rerender(<WorkOrderActions {...props} response={response} />);
    expect(screen.getByRole("button", { name: "Verify and close" })).toBeDisabled();
    response.data.latest_completion.actor_id = "b0000000-0000-4000-8000-000000000002";
    view.rerender(<WorkOrderActions {...props} response={{ ...response }} />);
    await user.click(screen.getByRole("button", { name: "Verify and close" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Reported work");
    expect(screen.getByLabelText("Verification result")).toHaveValue("VERIFIED_STOPPED");
    await user.type(screen.getByLabelText("Verification note"), "Independently confirmed stopped condition");
    await user.click(screen.getByRole("button", { name: "Confirm verify and close" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1]).toMatchObject({ verification: { result: "VERIFIED_STOPPED", note: "Independently confirmed stopped condition" } });
  });
  it("surfaces 409, refreshes for review, keeps draft and never silently updates the old revision", async () => {
    const user = userEvent.setup(); const { submit, refresh, props, view } = setup("BLOCK");
    submit.mockRejectedValueOnce(new WorkOrdersError(409, "WORK_ORDER_REVISION_CONFLICT", "request-409"));
    await user.click(screen.getByRole("button", { name: "Report blocker" }));
    await user.type(screen.getByLabelText("Reason"), "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Confirm report blocker" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Report blocker" })).toBeDisabled();
    const newer = workOrderExample(); newer.data.revision = 9; newer.data.available_commands = ["BLOCK"];
    view.rerender(<WorkOrderActions {...props} response={newer} fresh />);
    expect(submit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "I reviewed the refreshed order" }));
    await user.click(screen.getByRole("button", { name: "Report blocker" }));
    expect(screen.getByLabelText("Reason")).toHaveValue("Keep this draft");
    await user.click(screen.getByRole("button", { name: "Confirm report blocker" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0][1].expected_revision).toBe(7);
    expect(submit.mock.calls[1][1].expected_revision).toBe(9);
    expect(submit.mock.calls[0][2].key).not.toBe(submit.mock.calls[1][2].key);
  });
  it("removes the modal top layer after a lost response so exact-intent recovery is reachable", async () => {
    const user = userEvent.setup(); const { submit } = setup("BLOCK");
    submit.mockRejectedValue(new TypeError("Lost response"));
    await user.click(screen.getByRole("button", { name: "Report blocker" }));
    await user.type(screen.getByLabelText("Reason"), "Preserve the original reason");
    await user.click(screen.getByRole("button", { name: "Confirm report blocker" }));
    const retry = await screen.findByRole("button", { name: "Retry original intent" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(retry);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][1]).toEqual(submit.mock.calls[0][1]);
    expect(submit.mock.calls[1][2].key).toBe(submit.mock.calls[0][2].key);
  });
});

it.each([["ASSIGN", "Assign"], ["REASSIGN", "Reassign"], ["REASSIGN_FOR_REWORK", "Reassign for rework"]] as const)("%s loads the authenticated picker without injected options", async (command, name) => {
 const api = createWorkOrdersClient();
 vi.spyOn(api, "identity").mockResolvedValue(workOrderActor);
 const picker = vi.spyOn(api, "eligibleAssignees").mockResolvedValue({success: true, data: [{user_id: "b0000000-0000-4000-8000-000000000002", username: "Scoped operator"}], meta: {read_at: new Date().toISOString(), timezone: "UTC", has_more: false, next_after: null}});
 const response = workOrderExample(); response.data.available_commands = [command];
 const submit = vi.spyOn(api, "command").mockResolvedValue(response);
 render(<WorkOrderActions api={api} actor={workOrderActor} response={response} fresh={true} refresh={vi.fn()} />);
 await waitFor(() => expect(screen.getByRole("button", {name})).toBeEnabled());
 await userEvent.click(screen.getByRole("button", {name}));
 await userEvent.selectOptions(screen.getByLabelText("Eligible assignee"), "b0000000-0000-4000-8000-000000000002");
 if(command !== "ASSIGN") await userEvent.type(screen.getByLabelText("Reason"), "Independent review");
 await userEvent.click(screen.getByRole("button", {name: `Confirm ${name.toLowerCase()}`}));
 await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
 expect(picker).toHaveBeenCalledWith(response.data.factory_id, "", undefined, expect.objectContaining({signal: expect.any(AbortSignal)}));
});
