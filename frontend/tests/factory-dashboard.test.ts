import { describe, expect, it } from 'vitest';
import { factoryMetrics } from '@/lib/simulation/dashboard';
import type { Episode } from '@/types/generated/jcst';
import type { Simulation } from '@/lib/simulation/types';
import fixture from '../../contracts/jcst/v1/fixtures/engineering-bundle.json';

describe('factory dashboard evidence',()=>{
  it('reconstructs unavailable machine-time from actual occupancy and pre-transition failures',()=>{
    const episode=fixture.episodes[0] as unknown as Episode;
    const records=episode.records;
    const unavailable=records.reduce((sum,r)=>sum+r.breakdown.unavailable/episode.config.unavailable_cost,0);
    const lane={state:records.at(-1)!.after,records,failures:records.flatMap(r=>r.events).filter(e=>e.type==='failure').length,
      total_cost:episode.total_cost,unavailable_machine_ticks:unavailable,technician_busy_ticks:records.flatMap(r=>r.events).filter(e=>e.type==='occupancy').length};
    const session={primary:lane,step_seconds:900} as unknown as Simulation;
    const result=factoryMetrics(session);
    expect(result.stations.reduce((sum,s)=>sum+s.downtimeHours,0)).toBeCloseTo(unavailable*.25);
    expect(result.costs.reduce((sum,c)=>sum+c.value,0)).toBeCloseTo(episode.total_cost);
    expect(result.availability).toBeCloseTo(100*(1-unavailable/(lane.state.tick*3)));
    for(const bin of result.bins)expect(bin.working+bin.service+bin.down).toBeCloseTo(1);
  });
  it('does not invent performance before any simulated intervals',()=>{
    const session={primary:{state:fixture.episodes[0].records[0].before,records:[],failures:0,total_cost:0,unavailable_machine_ticks:0,technician_busy_ticks:0}} as unknown as Simulation;
    const result=factoryMetrics(session);
    expect(result.availability).toBeNull();expect(result.utilization).toBeNull();expect(result.bins).toEqual([]);
    expect(result.recentFailures).toBe(0);expect(result.stations.every(s=>s.availability===null)).toBe(true);
  });
});

describe('JCST conditional risk display',()=>{
  it('matches a constant unit exponential hazard and rises with age for wear-out components',async()=>{
    const {operatingRisk}=await import('@/lib/simulation/dashboard');
    expect(operatingRisk(0,{scale:1,shape:1})).toBeCloseTo(1-Math.exp(-1));
    expect(operatingRisk(5,{scale:1,shape:1})).toBeCloseTo(operatingRisk(0,{scale:1,shape:1}));
    expect(operatingRisk(5,{scale:6,shape:5})).toBeGreaterThan(operatingRisk(1,{scale:6,shape:5}));
  });
});
