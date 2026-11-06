import type { Simulation, SimulationRecord } from './types';

/** Compare physical transition times (also works after live history retention) so an old incident cannot pause every new step. */
export function hasNewFailure(before: number, next: Simulation): boolean {
  return next.primary.records.some((record, index) => (record.tick ?? index) >= before && record.events.some(event => event.type === 'failure'));
}

/** Notifications are evidence from the primary lane, retained across reloads. */
export function incidentNotifications(records: SimulationRecord[]) {
  return records.flatMap(record => record.events)
    .filter(event => event.type === 'failure' || event.type === 'completion' && event.kind === 'CM')
    .sort((a,b) => b.tick-a.tick || Number(b.type==='failure')-Number(a.type==='failure'));
}
