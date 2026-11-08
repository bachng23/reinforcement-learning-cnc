import source from './fixtures/simulation/source.json';
import t5 from './fixtures/simulation/t5.json';
import t6 from './fixtures/simulation/t6.json';
import t7 from './fixtures/simulation/t7.json';
import type { MachineHealth } from '@/types/generated/simulation-machine-health';
import type { Simulation, Lane } from '@/lib/simulation/types';

export function healthAt(tick: 5 | 6 | 7): MachineHealth {
  return structuredClone(({5:t5,6:t6,7:t7})[tick].data) as unknown as MachineHealth;
}
export function simulationAt(tick: 5 | 6 | 7): Simulation {
  const row = structuredClone(source.rows[String(tick) as '5' | '6' | '7']);
  const primary = { controller: 'corrective', total_cost: 0, controlled_cost: 0, tail_cost: 0,
    failures: 0, unavailable_machine_ticks: 0, technician_busy_ticks: 0, overrides: 0, ...row.payloadJson.primary } as Lane;
  return { id: row.id, revision: row.revision, case_id: 'base', physical_seed: '990000001', mode: 'policy',
    continuous: true, simulation_start: '2026-11-09T00:00:00Z', step_seconds: 900, horizon: 48, tail: 16,
    source_commit: source.sourceCommit, config: row.payloadJson.config, releases: {}, primary,
    baseline: { ...primary, controller: 'wait' }, activated: true, first_incident_tick: 5,
    status: tick < 7 ? 'REVIEW' : 'RUNNING', pending: tick === 5
      ? {tick:5,action:[[2,1,1]],baseline_action:[],catalogue:[[],[[2,1,1]]]}
      : tick === 6 ? {tick:6,action:[[0,0,0]],baseline_action:[],catalogue:[[],[[0,0,0]]]} : null,
    decisions: [], workflow: [] } as unknown as Simulation;
}
