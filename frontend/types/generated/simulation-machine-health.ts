/* Generated from the Backend PR #64 OpenAPI snapshot (eff27fe). Do not edit. */

export interface SimulationMachineHealthContract {
  health: MachineHealth;
}
export interface MachineHealth {
  sessionId: string;
  revision: number;
  tick: number;
  /**
   * Legacy default 900
   */
  stepSeconds: number;
  lane: "primary";
  source: "JCST_SIMULATION";
  machineIndex: number;
  machineStatus: "WORKING" | "BREAKDOWN" | "IN_SERVICE";
  /**
   * @minItems 1
   */
  components: [MachineHealthComponent, ...MachineHealthComponent[]];
  history: {
    /**
     * First selected interval tick or current tick if empty
     */
    fromTick: number;
    /**
     * Current tick; interval window is half-open
     */
    toTick: number;
    /**
     * Earliest retained interval
     */
    availableFromTick: number | null;
    limit: number;
    returnedIntervals: number;
    /**
     * Any elapsed intervals omitted by retention
     */
    truncated: boolean;
    /**
     * Missing half-open intervals inside the returned window; render breaks, never interpolate
     */
    gaps: {
      fromTick: number;
      toTick: number;
    }[];
    samples: MachineHealthSample[];
    events: MachineHealthEvent[];
  };
}
export interface MachineHealthComponent {
  componentIndex: number;
  ageTicks: number;
  /**
   * Component condition
   */
  failed: boolean;
  failureRisk: number | null;
  riskUnavailableReason: null | "BREAKDOWN" | "IN_SERVICE";
}
export interface MachineHealthSample {
  tick: number;
  sampleKind: "INTERVAL" | "CURRENT";
  machineStatus: "WORKING" | "BREAKDOWN" | "IN_SERVICE";
  componentIndex: number;
  ageTicks: number;
  failed: boolean;
  failureRisk: number | null;
  riskUnavailableReason: null | "BREAKDOWN" | "IN_SERVICE";
}
/**
 * Sorted by tick,recordTick,eventIndex. eventId = je1_ + base64url(UTF-8 compact JSON [sessionId,"primary",recordTick,eventIndex]), without padding. Shared Backend 2 physical event identity. eventIndex is ordinal in the full original events array including occupancy. Never derive identity from retained array position or revision. failure/completion tick is recordTick+1; start tick is recordTick. Only failure/start/completion for this machine.
 */
export interface MachineHealthEvent {
  eventId: string;
  type: "failure" | "start" | "completion";
  tick: number;
  recordTick: number;
  eventIndex: number;
  machineIndex: number;
  componentIndex: number;
  technicianIndex: number | null;
  kind: null | "PM" | "CM";
}
