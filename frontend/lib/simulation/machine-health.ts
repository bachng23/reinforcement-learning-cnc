import { researchRequest } from '@/lib/research-api/client';
import type { MachineHealth } from '@/types/generated/simulation-machine-health';
import type { Simulation } from './types';

export class InspectionMismatch extends Error {
  constructor() { super('Machine history changed. Reload the session to synchronize before reviewing.'); }
}

/** The command/session response is the snapshot authority; never replace it with history. */
export async function readMachineHealth(snapshot: Simulation, machine: number, signal: AbortSignal) {
  const health = await researchRequest<MachineHealth>(
    `/demo/sessions/${encodeURIComponent(snapshot.id)}/machines/${machine}/health?limit=256&expectedRevision=${snapshot.revision}`,
    { signal },
  );
  const state = snapshot.primary.state;
  const components = state.components[machine];
  const job = state.jobs.find(item => item?.machine === machine);
  const status = job ? 'IN_SERVICE' : components?.some(item => item.failed) ? 'BREAKDOWN' : 'WORKING';
  const validRisk = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0 && value <= 1);
  if (health.sessionId !== snapshot.id || health.revision !== snapshot.revision ||
      health.tick !== state.tick || health.machineIndex !== machine || health.lane !== 'primary' ||
      health.source !== 'JCST_SIMULATION' || health.stepSeconds !== (snapshot.step_seconds ?? 900) ||
      health.machineStatus !== status || !components || health.components.length !== components.length ||
      health.components.some((item, index) => item.componentIndex !== index ||
        item.failed !== components[index]?.failed || item.ageTicks !== components[index]?.age || !validRisk(item.failureRisk)) ||
      health.history.toTick !== health.tick || health.history.samples.some(sample=>!validRisk(sample.failureRisk) ||
        sample.tick < health.history.fromTick || sample.tick > health.tick || !components[sample.componentIndex]) ||
      health.history.events.some(event => event.machineIndex !== machine || !components[event.componentIndex])) {
    throw new InspectionMismatch();
  }
  return { snapshot, health };
}

export function inspectionError(error: unknown) {
  const data = error as { status?: number; code?: string; name?: string };
  if (data?.status === 401 || data?.name === 'AuthRedirectError') return 'Sign in to read machine history.';
  if (data?.status === 403) return 'You do not have permission to read this session.';
  if (data?.status === 404) return 'Machine history is not available for this session or API version.';
  if (error instanceof InspectionMismatch) return 'Machine health or work-order history does not match the simulator snapshot. Reload the session and review again.';
  if (data?.status === 409) return 'The session revision changed. Reload the session and review again.';
  if (data?.status === 503) return 'Machine history service is unavailable. Try again.';
  return 'Could not read machine history. Check your connection and try again.';
}
