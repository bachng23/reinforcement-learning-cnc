import { describe, expect, it } from 'vitest';
import { simulationTime } from '@/lib/simulation/clock';

describe('simulation calendar', () => {
  it('passes midnight and day boundaries without wrapping the simulated date', () => {
    const session = {simulation_start:'2026-11-06T23:45:00Z',step_seconds:900};
    expect(simulationTime(session,1).iso).toBe('2026-11-07T00:00:00.000Z');
    expect(simulationTime(session,97).iso).toBe('2026-11-08T00:00:00.000Z');
  });
});
