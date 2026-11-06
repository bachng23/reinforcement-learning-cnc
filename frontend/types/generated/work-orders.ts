/* Generated from contracts/v3/operations-http.openapi.json WorkOrder schemas. Do not edit. */

/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderAssignee".
 */
export type WorkOrderAssignee = {
  active: boolean;
  user_id: string;
  username: string;
} | null;
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderCommandRequest".
 */
export type WorkOrderCommandRequest =
  | WorkOrderASSIGNCommand
  | WorkOrderACCEPTCommand
  | WorkOrderSTARTCommand
  | WorkOrderBLOCKCommand
  | WorkOrderRESUMECommand
  | WorkOrderCOMPLETECommand
  | WorkOrderCLOSECommand
  | WorkOrderREQUEST_REWORKCommand
  | WorkOrderCANCELCommand
  | WorkOrderREASSIGNCommand
  | WorkOrderMANAGER_HOLDCommand
  | WorkOrderREASSIGN_FOR_REWORKCommand;
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderCompletion".
 */
export type WorkOrderCompletion = {
  actor_id: string;
  attempt: number;
  completed_at: string;
  report: WorkOrderReport;
} | null;

export interface WorkOrderContractCatalog {}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderACCEPTCommand".
 */
export interface WorkOrderACCEPTCommand {
  command: "ACCEPT";
  expected_revision: number;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderASSIGNCommand".
 */
export interface WorkOrderASSIGNCommand {
  assignee_user_id: string;
  command: "ASSIGN";
  expected_revision: number;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderBLOCKCommand".
 */
export interface WorkOrderBLOCKCommand {
  command: "BLOCK";
  expected_revision: number;
  /**
   * Trimmed, nonblank text.
   */
  reason: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderCANCELCommand".
 */
export interface WorkOrderCANCELCommand {
  command: "CANCEL";
  expected_revision: number;
  /**
   * Trimmed, nonblank text.
   */
  reason: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderCLOSECommand".
 */
export interface WorkOrderCLOSECommand {
  command: "CLOSE";
  expected_revision: number;
  verification: WorkOrderVerification;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderVerification".
 */
export interface WorkOrderVerification {
  /**
   * Trimmed, nonblank text.
   */
  note: string;
  result: "VERIFIED" | "VERIFIED_STOPPED";
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderCOMPLETECommand".
 */
export interface WorkOrderCOMPLETECommand {
  command: "COMPLETE";
  expected_revision: number;
  report: WorkOrderReport;
}
/**
 * STOPPED requires stop_reason. Server records completion time; caller timestamps are rejected.
 *
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderReport".
 */
export interface WorkOrderReport {
  outcome: "SUCCESS" | "PARTIAL" | "STOPPED";
  /**
   * Trimmed, nonblank text.
   */
  result: string;
  /**
   * Trimmed, nonblank text.
   */
  stop_reason?: string;
  /**
   * Trimmed, nonblank text.
   */
  work_performed: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderSTARTCommand".
 */
export interface WorkOrderSTARTCommand {
  command: "START";
  expected_revision: number;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderRESUMECommand".
 */
export interface WorkOrderRESUMECommand {
  command: "RESUME";
  expected_revision: number;
  /**
   * Trimmed, nonblank text.
   */
  reason: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderREQUEST_REWORKCommand".
 */
export interface WorkOrderREQUEST_REWORKCommand {
  command: "REQUEST_REWORK";
  expected_revision: number;
  /**
   * Trimmed, nonblank text.
   */
  reason: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderREASSIGNCommand".
 */
export interface WorkOrderREASSIGNCommand {
  assignee_user_id: string;
  command: "REASSIGN";
  expected_revision: number;
  /**
   * Trimmed, nonblank text.
   */
  reason: string;
}
/**
 * ADMIN/ENGINEER explicitly puts IN_PROGRESS work on hold without impersonating its assignee. Preserves actual start and reports; records manager identity and reason. No access restoration required.
 *
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderMANAGER_HOLDCommand".
 */
export interface WorkOrderMANAGER_HOLDCommand {
  command: "MANAGER_HOLD";
  expected_revision: number;
  reason: string;
}
/**
 * Independent ADMIN/ENGINEER returns COMPLETED work to ASSIGNED with a different eligible assignee. Increments attempt, preserves old completion and actual start. New assignee must ACCEPT then START.
 *
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderREASSIGN_FOR_REWORKCommand".
 */
export interface WorkOrderREASSIGN_FOR_REWORKCommand {
  assignee_user_id: string;
  command: "REASSIGN_FOR_REWORK";
  expected_revision: number;
  reason: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderCreateRequest".
 */
export interface WorkOrderCreateRequest {
  expected_head: WorkOrderExpectedHead;
  factory_id: string;
  /**
   * Trimmed, nonblank text.
   */
  overlap_override_reason?: string;
  source: WorkOrderSourceInput;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderExpectedHead".
 */
export interface WorkOrderExpectedHead {
  plan_version: number;
  revision: number;
  snapshot_id: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderSourceInput".
 */
export interface WorkOrderSourceInput {
  assignment_id: string;
  decision_case_id: string;
  schedule_hash: string;
  schedule_id: string;
  schedule_revision: number;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderDetail".
 */
export interface WorkOrderDetail {
  actual_completed_at: string | null;
  actual_started_at: string | null;
  assignee: WorkOrderAssignee;
  attempt: number;
  available_commands: (
    | "ASSIGN"
    | "ACCEPT"
    | "START"
    | "BLOCK"
    | "RESUME"
    | "COMPLETE"
    | "CLOSE"
    | "REQUEST_REWORK"
    | "CANCEL"
    | "REASSIGN"
    | "MANAGER_HOLD"
    | "REASSIGN_FOR_REWORK"
  )[];
  basis_snapshot_id: string;
  blocker: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  factory_id: string;
  id: string;
  latest_completion: WorkOrderCompletion;
  machine_id: string;
  machine_in_current_snapshot: boolean | null;
  maintenance_request_id: string;
  overdue: boolean;
  planned_end_at: string;
  planned_start_at: string;
  requirements: WorkOrderRequirements;
  revision: number;
  source: WorkOrderSource;
  source_is_current: boolean;
  source_technician_ids: string[];
  status: "UNASSIGNED" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CLOSED" | "CANCELLED";
  updated_at: string;
  verification: {
    actor_id: string;
    /**
     * Trimmed, nonblank text.
     */
    note: string;
    result: "VERIFIED" | "VERIFIED_STOPPED";
    verified_at: string;
  } | null;
  waiting_verification: boolean;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderRequirements".
 */
export interface WorkOrderRequirements {
  action_type: string;
  expected_duration_minutes: number;
  maintenance_type: string;
  mandatory: boolean;
  minimum_skill_level: number;
  priority: string;
  required_skill_ids: string[];
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderSource".
 */
export interface WorkOrderSource {
  assignment_id: string;
  basis_snapshot_hash: string;
  basis_snapshot_id: string;
  decision_case_id: string;
  published_plan_version: number;
  schedule_hash: string;
  schedule_id: string;
  schedule_revision: number;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderEligibleAssigneesResponse".
 */
export interface WorkOrderEligibleAssigneesResponse {
  data: {
    user_id: string;
    username: string;
  }[];
  meta: {
    has_more: boolean;
    next_after: string | null;
    read_at: string;
    timezone: "UTC";
  };
  success: true;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderError".
 */
export interface WorkOrderError {
  error: {
    code: string;
    message: string;
  };
  requestId: string;
  success: false;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderEvent".
 */
export interface WorkOrderEvent {
  actor_id: string;
  command:
    | "CREATE"
    | "ASSIGN"
    | "ACCEPT"
    | "START"
    | "BLOCK"
    | "RESUME"
    | "COMPLETE"
    | "CLOSE"
    | "REQUEST_REWORK"
    | "CANCEL"
    | "REASSIGN"
    | "MANAGER_HOLD"
    | "REASSIGN_FOR_REWORK";
  id: string;
  occurred_at: string;
  payload: WorkOrderEventPayload;
  sequence: number;
  work_order_id: string;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderEventPayload".
 */
export interface WorkOrderEventPayload {
  assignee_user_id: string | null;
  attempt: number;
  from_status:
    "UNASSIGNED" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CLOSED" | "CANCELLED" | null;
  /**
   * Trimmed, nonblank text.
   */
  overlap_override_reason?: string;
  overlapping_work_order_ids?: string[];
  /**
   * Trimmed, nonblank text.
   */
  reason?: string;
  report?: WorkOrderReport;
  revision: number;
  to_status: "UNASSIGNED" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CLOSED" | "CANCELLED";
  verification?: WorkOrderVerification;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderEventsResponse".
 */
export interface WorkOrderEventsResponse {
  data: WorkOrderEvent[];
  meta: {
    has_more: boolean;
    limit: number;
    next_after_sequence: number | null;
    read_at: string;
    timezone: "UTC";
  };
  success: true;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderListResponse".
 */
export interface WorkOrderListResponse {
  data: WorkOrderSummary[];
  meta: {
    has_more: boolean;
    limit: number;
    next_cursor: string | null;
    read_at: string;
    timezone: "UTC";
  };
  success: true;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderSummary".
 */
export interface WorkOrderSummary {
  actual_completed_at: string | null;
  actual_started_at: string | null;
  assignee: WorkOrderAssignee;
  basis_snapshot_id: string;
  created_at: string;
  factory_id: string;
  id: string;
  machine_id: string;
  machine_in_current_snapshot: boolean | null;
  maintenance_request_id: string;
  overdue: boolean;
  planned_end_at: string;
  planned_start_at: string;
  revision: number;
  source: WorkOrderSource;
  source_is_current: boolean;
  status: "UNASSIGNED" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CLOSED" | "CANCELLED";
  updated_at: string;
  waiting_verification: boolean;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderLookupResponse".
 */
export interface WorkOrderLookupResponse {
  data: WorkOrderSummary[];
  meta: WorkOrderReadMeta;
  success: true;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderReadMeta".
 */
export interface WorkOrderReadMeta {
  read_at: string;
  timezone: "UTC";
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderOriginResponse".
 */
export interface WorkOrderOriginResponse {
  data: {
    id: string;
  };
  meta: {
    read_at: string;
    timezone: "UTC";
  };
  success: true;
}
/**
 * This interface was referenced by `WorkOrderContractCatalog`'s JSON-Schema
 * via the `definition` "WorkOrderResponse".
 */
export interface WorkOrderResponse {
  data: WorkOrderDetail;
  meta: WorkOrderReadMeta;
  success: true;
}
