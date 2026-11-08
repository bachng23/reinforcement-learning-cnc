import type { Simulation } from './types';

export const policyNames: Record<string, string> = {
  S: 'Structured PPO · S', A: 'Ablated PPO · A', F: 'Flat PPO · F',
  risk: 'Risk-based maintenance', corrective: 'Repair after failure',
  threshold5: 'Age-threshold maintenance', wait: 'No new maintenance',
};

/** Display scale for the engineering simulation, not calibrated physical time. */
export function simulationTime(session: Pick<Simulation, 'simulation_start' | 'step_seconds'>, tick: number) {
  const start = session.simulation_start ? Date.parse(session.simulation_start) : Date.UTC(2026, 10, 6, 0);
  const date = new Date(start + tick * (session.step_seconds ?? 900) * 1000);
  return {
    iso: date.toISOString(),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
  };
}

export function serviceDuration(steps: number, stepSeconds = 900) {
  const minutes = Math.round(steps * stepSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${minutes} min`;
}
