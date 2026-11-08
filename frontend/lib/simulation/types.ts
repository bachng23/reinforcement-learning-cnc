import type { Config, State, Record as TickRecord } from '@/types/generated/jcst';
export type Matching = number[][];
export type SimulationRecord = Omit<TickRecord, 'events'> & { events: (Omit<TickRecord['events'][number], 'uniform'> & { uniform?: number | string | null })[] };
export type Lane = {
  comparison_start?: {
    tick: number; failures: number; total_cost: number; downtime: number;
    controlled_cost?: number; technician_busy_ticks?: number; overrides?: number;
  };
  completed_jobs?: number[];
  controller: string; state: State; records: SimulationRecord[];
  total_cost: number; controlled_cost: number; tail_cost: number;
  failures: number; unavailable_machine_ticks: number; technician_busy_ticks: number; overrides: number;
};
export type Simulation = {
  id: string; revision: number; case_id: string; physical_seed: string; mode: 'incident' | 'policy';
  continuous?: boolean; simulation_start?: string; step_seconds?: number;
  horizon: number; tail: number; source_commit: string; config: Config;
  releases: Record<string, { release_id: string; sha256: string }>;
  primary: Lane; baseline: Lane; status: 'RUNNING' | 'REVIEW' | 'COMPLETE'; activated: boolean;
  first_incident_tick: number | null;
  pending: null | { tick: number; action: Matching; baseline_action: Matching; catalogue: Matching[] };
  workflow: { tick: number; stage: string; message: string }[];
  audits?: Record<string,{status:string;records:number;scope:string}>;
  decisions: { tick: number; actor: string; reason: string; action: Matching; proposed_action: Matching; override: boolean }[];
};
export const matchingLabel = (action: Matching) => action.length ? action.map(([m,c,j]) => `T${j+1} → M${m+1}/C${c+1}`).join(' · ') : 'WAIT — keep current commitments';
