import { describe, expect, it } from 'vitest';
import { hasNewFailure, incidentNotifications } from '@/lib/simulation/presentation';
import type { Simulation, SimulationRecord } from '@/lib/simulation/types';
const record=(events:unknown[])=>({events} as SimulationRecord);
describe('live simulator event presentation',()=>{
  it('pauses only for newly appended primary failures, including failures within a batch',()=>{
    const primary={records:[record([{type:'failure'}]),record([{type:'completion',kind:'CM'}]) ]};
    const s={primary} as Simulation;
    expect(hasNewFailure(0,s)).toBe(true);expect(hasNewFailure(1,s)).toBe(false);
    primary.records.push(record([{type:'failure'}]),record([]));
    expect(hasNewFailure(2,s)).toBe(true);
  });
  it('shows chronological evidence newest first, excludes PM and does not mutate the trace',()=>{
    const records=[record([{type:'failure',tick:5},{type:'occupancy',tick:5}]),record([{type:'completion',kind:'PM',tick:7},{type:'failure',tick:7},{type:'completion',kind:'CM',tick:7}])];
    expect(incidentNotifications(records)).toEqual([{type:'failure',tick:7},{type:'completion',kind:'CM',tick:7},{type:'failure',tick:5}]);
    expect(records[0].events[0].type).toBe('failure');expect(records[1].events).toHaveLength(3);
  });
});

describe('continuous simulator history', () => {
  it('detects new failures after old trace records have been discarded', () => {
    const s = { primary: { records: [
      {tick: 255, events: [{type:'failure'}]}, {tick: 256, events: []},
      {tick: 257, events: [{type:'failure'}]},
    ] } } as unknown as Simulation;
    expect(hasNewFailure(256,s)).toBe(true);
    expect(hasNewFailure(258,s)).toBe(false);
  });
});
