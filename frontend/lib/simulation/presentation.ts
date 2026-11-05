import type { Simulation } from './types';

/** Playback may pause on newly appended evidence, never on old resolved failures. */
export function hasNewFailure(before: Simulation | undefined, after: Simulation) {
  return after.primary.records.slice(before?.primary.records.length ?? 0)
    .some(record => record.events.some(event => event.type === 'failure'));
}
