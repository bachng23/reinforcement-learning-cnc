import type { Simulation, SimulationRecord } from './types';

/** Detect failures introduced by the command, including controlled failures at the arriving boundary. */
export function hasNewFailure(before: number, next: Simulation): boolean {
  return next.primary.records.some((record, index) =>
    (record.tick ?? index) >= before && record.events.some(event => event.type === 'failure')) ||
    (next.incidents ?? []).some(event =>
      event.status === 'APPLIED' && event.appliedTick !== null && event.appliedTick > before);
}

/** Notifications are evidence from the primary lane, retained across reloads. */
export function incidentNotifications(records: SimulationRecord[]) {
  return records.flatMap(record => record.events)
    .filter(event => event.type === 'failure' || event.type === 'completion' && event.kind === 'CM')
    .sort((a,b) => b.tick-a.tick || Number(b.type==='failure')-Number(a.type==='failure'));
}
