/* Generated verbatim from the Backend situation consumer DTO (be8b299). Do not edit. */
export type IncidentStatus = 'SCHEDULED' | 'APPLIED' | 'SKIPPED';
export interface Incident {
  eventId: string; machineIndex: number; componentIndex: number;
  scheduledTick: number; status: IncidentStatus; appliedTick: number | null;
  reason: 'COMPONENT_ALREADY_FAILED' | 'MACHINE_IN_SERVICE' | null;
  requestedReason: string; createdBy: string; createdAt: string;
}
export interface SnapshotMetadata {
  snapshotId: string; schemaVersion: 'jcst-demo-snapshot/1';
  sourceSessionId: string; sourceRevision: number; sourceTick: number;
  sourceCommit: string; snapshotHash: string; name: string; description: string;
  layoutId: string; createdAt: string; sessionId: string; revision: number; tick: number;
  summary?: { caseId: string; seed: string; status: 'RUNNING' | 'REVIEW' | 'COMPLETE';
    primary: string; baseline: string; machineCount: number; technicianCount: number };
}
export interface SaveSnapshot {
  revision: number; name: string; description?: string; layoutId: string;
}
export interface OpenSnapshot { revision: number }
export interface CreateIncident {
  revision: number; machineIndex: number; componentIndex: number;
  scheduledTick: number; reason: string;
}
export interface SnapshotList { items: SnapshotMetadata[]; nextCursor: string | null }
export interface IncidentList {
  sessionId: string; revision: number; tick: number;
  source: 'JCST_SIMULATION'; events: Incident[];
}
export interface BranchProvenance {
  branchId: string; snapshotId: string; snapshotHash: string;
  sourceSessionId: string; sourceRevision: number; sourceTick: number;
  branchStartTick: number; interventionRevision: number;
}
export interface DemoSituationSession {
  id: string; sessionId: string; revision: number; tick: number; createdAt: string;
  simulation_start: string; step_seconds: number; playbackPaused: true;
  status: 'RUNNING' | 'REVIEW' | 'COMPLETE'; branch: BranchProvenance;
  incidents?: Incident[];
  /** Other existing DemoSession runtime fields retain their current contract. */
  [runtimeField: string]: unknown;
}
export interface CreateIncidentResult { session: DemoSituationSession; event: Incident }
