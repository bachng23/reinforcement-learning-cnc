import example from "../../backend/examples/work-orders.json";
import type { WorkOrderEvent, WorkOrderEventsResponse, WorkOrderListResponse, WorkOrderResponse } from "@/types/generated/work-orders";
export const workOrderExample = () => structuredClone(example.created) as WorkOrderResponse;
export const workOrderListExample = () => structuredClone(example.list) as WorkOrderListResponse;
export const workOrderActor = { id: "b0000000-0000-4000-8000-000000000001", role: "ENGINEER", username: "engineer" };
export function eventExample(sequence = 1): WorkOrderEvent {
  return { id: `c0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, work_order_id: workOrderExample().data.id, sequence, actor_id: workOrderActor.id,
    occurred_at: example.created.meta.read_at, command: sequence === 1 ? "CREATE" : "COMPLETE", payload: { from_status: sequence === 1 ? null : "IN_PROGRESS", to_status: sequence === 1 ? "UNASSIGNED" : "COMPLETED", revision: sequence, attempt: sequence, assignee_user_id: sequence === 1 ? null : workOrderActor.id,
      ...(sequence === 1 ? {} : { report: { outcome: "SUCCESS" as const, work_performed: `Attempt ${sequence} inspection`, result: `Attempt ${sequence} result` } }) } };
}
export function eventsExample(after = 0, more = false): WorkOrderEventsResponse {
  return { success: true, data: [eventExample(after + 1)], meta: { ...example.created.meta, timezone: "UTC", limit: 1, has_more: more, next_after_sequence: after + 1 } };
}
