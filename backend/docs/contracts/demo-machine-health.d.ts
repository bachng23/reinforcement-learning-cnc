/** Additive product API read DTO. OpenAPI and fixtures are the wire authority. */
export type MachineHealthStatus = 'WORKING' | 'BREAKDOWN' | 'IN_SERVICE';
export type RiskUnavailableReason = 'BREAKDOWN' | 'IN_SERVICE' | null;
export interface MachineHealthComponent {
  componentIndex: number;
  ageTicks: number;
  failed: boolean;
  /** Conditional next-operating-interval probability, 0..1; null when stopped. */
  failureRisk: number | null;
  riskUnavailableReason: RiskUnavailableReason;
}
export interface MachineHealthSample extends MachineHealthComponent {
  tick: number;
  sampleKind: 'INTERVAL' | 'CURRENT';
  machineStatus: MachineHealthStatus;
}
export interface MachineHealthEvent {
  eventId: string;
  type: 'failure' | 'start' | 'completion';
  tick: number;
  recordTick: number;
  eventIndex: number;
  machineIndex: number;
  componentIndex: number;
  technicianIndex: number | null;
  kind: 'PM' | 'CM' | null;
}
export interface MachineHealth {
  sessionId: string;
  revision: number;
  tick: number;
  stepSeconds: number;
  lane: 'primary';
  source: 'JCST_SIMULATION';
  machineIndex: number;
  machineStatus: MachineHealthStatus;
  components: MachineHealthComponent[];
  history: {
    fromTick: number;
    toTick: number;
    availableFromTick: number | null;
    limit: number;
    returnedIntervals: number;
    truncated: boolean;
    /** Missing half-open intervals inside the returned history window. */
    gaps: { fromTick: number; toTick: number }[];
    samples: MachineHealthSample[];
    events: MachineHealthEvent[];
  };
}
export interface MachineHealthSuccess {
  success: true;
  data: MachineHealth;
}
