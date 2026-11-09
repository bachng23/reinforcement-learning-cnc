/** Producer contract: backend/research-openapi.yaml. Indexes are zero-based. */
export interface DemoWorkOrder {
  workOrderId: string;
  machineIndex: number;
  componentIndex: number;
  technicianIndex: number;
  kind: 'PM' | 'CM';
  status: 'IN_PROGRESS' | 'COMPLETED';
  startedTick: number;
  completedTick: number | null;
  plannedDurationTicks: number;
  remainingTicks: number | null;
  waitTicks: number | null;
  startEventId: string;
  completionEventId: string | null;
  failureEventId: string | null;
  decisionTick: number | null;
  assignmentSource: 'AUTOMATIC' | 'MANUAL_APPROVAL' | 'OVERRIDE' | 'UNKNOWN';
}
export interface DemoWorkOrders {
  contractVersion: 'jcst-work-orders/v1';
  sessionId: string;
  revision: number;
  tick: number;
  stepSeconds: number;
  lane: 'primary';
  source: 'JCST_SIMULATION';
  historyCoverage: 'COMPLETE' | 'PARTIAL';
  total: number;
  items: DemoWorkOrder[];
}
export interface DemoWorkOrdersResponse { success: true; data: DemoWorkOrders }
