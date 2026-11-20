export type Availability = 'AVAILABLE' | 'BUSY' | 'ABSENT';
export type TechnicianEventType = 'ABSENCE_STARTED' | 'ABSENCE_ENDED' | 'ABSENCE_RETURNED_EARLY';
export interface TechnicianEvent {
  eventId: string; technicianIndex: number; type: TechnicianEventType; tick: number;
  actor: {type: 'USER'; userId: string} | {type: 'SYSTEM'; userId: null}; reason: string;
}
export interface TechnicianSummary {
  technicianIndex: number; availability: Availability;
  currentJob: {machine: number; component: number; technician: number; kind: 'PM'|'CM'; remaining: number} | null;
  activeAbsence: {startTick: number; returnTick: number; eventId: string} | null;
  returnTick: number | null;
}
export interface TechnicianOrigin {eventId: string; tick: number; workforceVersion: number}
export interface TechnicianAbsence {
  eventId: string; automaticEndEventId: string; technicianIndex: number;
  startTick: number; returnTick: number; endedTick: number | null; endedByEventId: string | null;
}
export interface TechnicianCalendar {
  schemaVersion: 'jcst-technician-availability/1'; version: number;
  absences: TechnicianAbsence[]; events: TechnicianEvent[]; origin: TechnicianOrigin | null;
}
export interface TechnicianComparisonContext {
  workforceVersion: number; workforceHash: string; cacheIdentity: string;
  origin: TechnicianOrigin | null; requiresCommonSnapshot: boolean;
}
export interface TechniciansResponse {
  sessionId: string; revision: number; tick: number; stepSeconds: number;
  lane: 'primary'; technicians: TechnicianSummary[]; comparisonContext: TechnicianComparisonContext;
}
export interface TechnicianCommandResponse extends TechniciansResponse {
  /** Full existing DemoSession, with technician summary and comparisonContext. */
  session: Record<string, unknown> & {technicianAvailability: TechnicianCalendar};
}
export interface StartAbsence {revision: number; durationTicks: number; reason: string}
export interface ReturnEarly {revision: number; reason: string}
