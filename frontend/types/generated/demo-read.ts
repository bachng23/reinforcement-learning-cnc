/* Generated from backend/research-openapi.yaml. Do not edit. */

/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoCommandRequest".
 */
export type DemoCommandRequest =
  | {
      revision: number;
      command: "advance";
      autoApprove?: boolean;
    }
  | {
      revision: number;
      command: "autoplay";
      stopAt: "incident" | "review" | "dispatch" | "repair" | "complete";
      maxTicks?: number;
    }
  | {
      revision: number;
      command: "approve";
      reason: string;
    }
  | {
      revision: number;
      command: "override";
      reason: string;
      /**
       * @maxItems 3
       */
      action: [number, number, number, ...number[]][];
    };

export interface DemoReadCatalog {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoBatch".
 */
export interface DemoBatch {
  batchId: string;
  productName: string;
  quantity: number | null;
  dueAt: string | null;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoMachineProfile".
 */
export interface DemoMachineProfile {
  machineId: "M1" | "M2" | "M3";
  simulatorMachineIndex: number;
  name: string;
  type: string;
  operation: string;
  operationOrder: number;
  lineId: string;
  location: {
    zone: string;
    bay: string;
    x: number;
    y: number;
  };
  assignedBatch: DemoBatch;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoContext".
 */
export interface DemoContext {
  contextVersion: string;
  contextOrigin: "ILLUSTRATIVE_DEMO";
  factory: {
    factoryId: string;
    name: string;
  };
  layout: {
    coordinateUnit: "SCHEMATIC_GRID";
    columns: number;
    rows: number;
  };
  lines: {
    lineId: string;
    name: string;
    /**
     * @maxItems 3
     */
    machineIds: ("M1" | "M2" | "M3")[];
  }[];
  /**
   * @maxItems 3
   */
  machines: DemoMachineProfile[];
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoMachineState".
 */
export interface DemoMachineState {
  machineId: "M1" | "M2" | "M3";
  simulatorMachineIndex: number;
  machineState: "WORKING" | "BREAKDOWN" | "IN_SERVICE";
  /**
   * @maxItems 2
   */
  components: {
    componentId: "C1" | "C2";
    ageTicks: number;
    failed: boolean;
  }[];
  /**
   * @maxItems 3
   */
  currentJobs: {
    technicianId: string;
    componentId: "C1" | "C2";
    kind: "PM" | "CM";
    remainingTicks: number;
  }[];
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoPhysicalEvidence".
 */
export interface DemoPhysicalEvidence {
  recordIndex: number;
  eventIndex: number;
  tick: number;
  type: "failure" | "start" | "completion";
  machineId: "M1" | "M2" | "M3";
  componentId: "C1" | "C2";
  technicianId: string | null;
  kind: ("PM" | "CM") | null;
  durationTicks: number | null;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoDecisionEvidence".
 */
export interface DemoDecisionEvidence {
  decisionIndex: number;
  tick: number;
  actor: string;
  reason: string;
  /**
   * @maxItems 3
   */
  action: number[][];
  override: boolean;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoIncident".
 */
export interface DemoIncident {
  incidentId: string;
  machineId: "M1" | "M2" | "M3";
  simulatorMachineIndex: number;
  componentId: "C1" | "C2";
  simulatorComponentIndex: number;
  status: "OPEN" | "IN_SERVICE" | "RESOLVED";
  openedAtTick: number;
  serviceStartedAtTick: number | null;
  resolvedAtTick: number | null;
  failure: DemoPhysicalEvidence;
  /**
   * @maxItems 3
   */
  timeline: DemoPhysicalEvidence[];
  /**
   * @maxItems 1
   */
  decisions: DemoDecisionEvidence[];
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoServiceHistory".
 */
export interface DemoServiceHistory {
  serviceId: string;
  machineId: "M1" | "M2" | "M3";
  componentId: "C1" | "C2";
  technicianId: string;
  kind: "PM" | "CM";
  startedAtTick: number;
  completedAtTick: number | null;
  durationTicks: number;
  start: DemoPhysicalEvidence;
  completion: DemoPhysicalEvidence | null;
  decision: DemoDecisionEvidence | null;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoFactoryRead".
 */
export interface DemoFactoryRead {
  sessionId: string;
  revision: number;
  tick: number;
  lane: "primary";
  contextStatus: "AVAILABLE" | "MISSING_LEGACY";
  contextVersion: string | null;
  contextOrigin: "ILLUSTRATIVE_DEMO" | null;
  context: DemoContext | null;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoMachineRead".
 */
export interface DemoMachineRead {
  sessionId: string;
  revision: number;
  tick: number;
  lane: "primary";
  contextStatus: "AVAILABLE" | "MISSING_LEGACY";
  contextVersion: string | null;
  contextOrigin: "ILLUSTRATIVE_DEMO" | null;
  context: DemoContext | null;
  profile: DemoMachineProfile | null;
  assignedBatch: DemoBatch | null;
  machineId: "M1" | "M2" | "M3";
  simulatorMachineIndex: number;
  machineState: "WORKING" | "BREAKDOWN" | "IN_SERVICE";
  /**
   * @maxItems 2
   */
  components: {
    componentId: "C1" | "C2";
    ageTicks: number;
    failed: boolean;
  }[];
  /**
   * @maxItems 3
   */
  currentJobs: {
    technicianId: string;
    componentId: "C1" | "C2";
    kind: "PM" | "CM";
    remainingTicks: number;
  }[];
  /**
   * @maxItems 192
   */
  maintenanceHistory: DemoServiceHistory[];
  /**
   * @maxItems 128
   */
  incidentIds: string[];
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoIncidentListRead".
 */
export interface DemoIncidentListRead {
  sessionId: string;
  revision: number;
  tick: number;
  lane: "primary";
  contextStatus: "AVAILABLE" | "MISSING_LEGACY";
  contextVersion: string | null;
  contextOrigin: "ILLUSTRATIVE_DEMO" | null;
  context: DemoContext | null;
  /**
   * @maxItems 384
   */
  items: DemoIncident[];
  limit: 384;
  truncated: false;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoIncidentRead".
 */
export interface DemoIncidentRead {
  sessionId: string;
  revision: number;
  tick: number;
  lane: "primary";
  contextStatus: "AVAILABLE" | "MISSING_LEGACY";
  contextVersion: string | null;
  contextOrigin: "ILLUSTRATIVE_DEMO" | null;
  context: DemoContext | null;
  incident: DemoIncident;
  machine: DemoMachineState;
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoObservationRead".
 */
export interface DemoObservationRead {
  sessionId: string;
  revision: number;
  tick: number;
  lane: "primary";
  contextStatus: "AVAILABLE" | "MISSING_LEGACY";
  contextVersion: string | null;
  contextOrigin: "ILLUSTRATIVE_DEMO" | null;
  context: DemoContext | null;
  status: "RUNNING" | "REVIEW" | "COMPLETE";
  /**
   * @maxItems 3
   */
  machines: DemoMachineState[];
  /**
   * @maxItems 384
   */
  incidents: DemoIncident[];
  /**
   * @maxItems 192
   */
  maintenanceHistory: DemoServiceHistory[];
}
/**
 * This interface was referenced by `DemoReadCatalog`'s JSON-Schema
 * via the `definition` "DemoCreateRequest".
 */
export interface DemoCreateRequest {
  case?: "base" | "generalist";
  seed?: string;
  mode?: "incident" | "policy";
  primary?: "S" | "A" | "F";
  baseline?: "S" | "A" | "F";
}
