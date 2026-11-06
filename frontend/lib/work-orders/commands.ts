import type { WorkOrderCommandRequest, WorkOrderDetail, WorkOrderReport } from "@/types/generated/work-orders";
export type CommandName = WorkOrderDetail["available_commands"][number];
export type CommandDraft = { reason: string; assignee: string; outcome: WorkOrderReport["outcome"]; work: string; result: string; stopReason: string; verification: "VERIFIED" | "VERIFIED_STOPPED"; note: string };
export const emptyCommandDraft: CommandDraft = { reason: "", assignee: "", outcome: "SUCCESS", work: "", result: "", stopReason: "", verification: "VERIFIED", note: "" };
export const commandLabels: Record<CommandName, string> = {
  ASSIGN: "Assign", ACCEPT: "Accept work", START: "Start work", BLOCK: "Report blocker", RESUME: "Resume work", COMPLETE: "Report completion", CLOSE: "Verify and close", REQUEST_REWORK: "Request rework", CANCEL: "Cancel work order", REASSIGN: "Reassign", MANAGER_HOLD: "Manager hold", REASSIGN_FOR_REWORK: "Reassign for rework",
};
export const needsAssignee = (command: CommandName) => ["ASSIGN", "REASSIGN", "REASSIGN_FOR_REWORK"].includes(command);
export class WorkOrderFormError extends Error { constructor(public field: keyof CommandDraft, message: string) { super(message); } }
export function buildWorkOrderCommand(command: CommandName, revision: number, draft: CommandDraft): WorkOrderCommandRequest {
  const base = { expected_revision: revision };
  if (command === "ACCEPT" || command === "START") return { command, ...base };
  if (needsAssignee(command) && !draft.assignee) throw new WorkOrderFormError("assignee", "Choose an eligible assignee.");
  if (command === "ASSIGN") return { command, ...base, assignee_user_id: draft.assignee };
  if (command === "COMPLETE") {
    if (!draft.work.trim()) throw new WorkOrderFormError("work", "Work performed is required.");
    if (!draft.result.trim()) throw new WorkOrderFormError("result", "Result is required.");
    if (draft.outcome === "STOPPED" && !draft.stopReason.trim()) throw new WorkOrderFormError("stopReason", "STOPPED requires a stop reason.");
    return { command, ...base, report: { outcome: draft.outcome, work_performed: draft.work.trim(), result: draft.result.trim(), ...(draft.outcome === "STOPPED" ? { stop_reason: draft.stopReason.trim() } : {}) } };
  }
  if (command === "CLOSE") {
    if (!draft.note.trim()) throw new WorkOrderFormError("note", "An independent verification note is required.");
    return { command, ...base, verification: { result: draft.verification, note: draft.note.trim() } };
  }
  if (!draft.reason.trim()) throw new WorkOrderFormError("reason", "A reason is required.");
  if (command === "REASSIGN" || command === "REASSIGN_FOR_REWORK") return { command, ...base, reason: draft.reason.trim(), assignee_user_id: draft.assignee };
  switch (command) {
    case "BLOCK": return { command, ...base, reason: draft.reason.trim() };
    case "RESUME": return { command, ...base, reason: draft.reason.trim() };
    case "REQUEST_REWORK": return { command, ...base, reason: draft.reason.trim() };
    case "CANCEL": return { command, ...base, reason: draft.reason.trim() };
    case "MANAGER_HOLD": return { command, ...base, reason: draft.reason.trim() };
  }
}
