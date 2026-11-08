import type { MachineHealth, MachineHealthEvent } from '@/types/generated/simulation-machine-health';
import type { Lane } from './types';

// Presentation grouping of physical evidence, not an invented Work Order DTO or lifecycle command.
export type ServiceEvidence = {
  id: string; component: number; technician: number | null; kind: 'PM' | 'CM' | null;
  start: number | null; completion: number | null; remaining: number | null; wait: number | null;
  active: boolean;
};
export function serviceEvidence(health: MachineHealth, lane: Lane): ServiceEvidence[] {
  const entries: ServiceEvidence[] = [];
  const failures = new Map<number, MachineHealthEvent>();
  const interrupted = (from: number | null, to: number) => from === null ||
    health.history.gaps.some(gap => gap.fromTick < to && gap.toTick > from);
  for (const event of health.history.events) {
    if (event.type === 'failure') { failures.set(event.componentIndex, event); continue; }
    if (event.type === 'start') {
      const failure = failures.get(event.componentIndex);
      entries.push({ id: event.eventId, component: event.componentIndex, technician: event.technicianIndex,
        kind: event.kind, start: event.tick, completion: null, remaining: null, active: false,
        wait: event.kind === 'CM' && failure && !interrupted(failure.tick, event.tick) ? event.tick - failure.tick : null });
    } else {
      const start = entries.findLast(item => item.completion === null && item.component === event.componentIndex &&
        item.technician === event.technicianIndex && item.kind === event.kind && !interrupted(item.start, event.tick));
      if (start) start.completion = event.tick;
      else entries.push({ id: event.eventId, component: event.componentIndex, technician: event.technicianIndex,
        kind: event.kind, start: null, completion: event.tick, remaining: null, wait: null, active: false });
      failures.delete(event.componentIndex);
    }
  }
  for (const job of lane.state.jobs) {
    if (!job || job.machine !== health.machineIndex) continue;
    const start = entries.findLast(item => item.completion === null && item.component === job.component &&
      item.technician === job.technician && item.kind === job.kind && !interrupted(item.start, health.tick));
    if (start) { start.active = true; start.remaining = job.remaining; }
    else entries.push({ id: `current:${health.sessionId}:${job.machine}:${job.component}:${job.technician}`,
      component: job.component, technician: job.technician, kind: job.kind, start: null,
      completion: null, remaining: job.remaining, wait: null, active: true });
  }
  return entries.sort((a, b) => Number(b.active) - Number(a.active) ||
    (b.start ?? b.completion ?? -1) - (a.start ?? a.completion ?? -1));
}
