import { researchRequest, ResearchApiError } from '@/lib/research-api/client';
import type { DemoObservationRead, DemoMachineRead, DemoIncidentRead } from '@/types/generated/demo-read';

export function readError(error: unknown): string {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (status === 401 || error instanceof Error && error.name === 'AuthRedirectError') return 'Sign in to view this simulation.';
  if (status === 403) return 'You do not have permission for this operation.';
  if (status === 404) return 'Session, machine or incident not found or no longer accessible.';
  if (status === 409) return 'Session revision changed. Playback is paused. Reload and review the current state before deciding again.';
  if (status === 503) return 'Simulation service unavailable. Retry when the service is ready.';
  if (status === 422) return 'Simulator input or checkpoint validation failed. Review the inputs and runtime registration.';
  if (status === 504) return 'Simulator deadline exceeded. Keep the original command for outcome recovery.';
  if (status === 500) return 'Stored simulation evidence is inconsistent. No sample data is substituted.';
  return 'Unable to read the simulation. Check the connection and retry.';
}
export function isConflict(error: unknown) { return !!error && typeof error === 'object' && 'status' in error && error.status === 409; }

function consistent<T extends {sessionId: string; revision: number; tick: number; lane: string}>(data: T, id: string, revision: number): T {
  if (data.sessionId !== id || data.revision !== revision || data.lane !== 'primary') throw new ResearchApiError(409, 'DEMO_STALE', 'Observation does not match the selected session revision.');
  return data;
}
async function read<T extends {sessionId: string; revision: number; tick: number; lane: string}>(id: string, revision: number, resource: string, signal?: AbortSignal) {
  return consistent(await researchRequest<T>(`/demo/sessions/${encodeURIComponent(id)}/${resource}?expectedRevision=${revision}`, { signal }), id, revision);
}
export const liveApi = {
  observation: (id: string, revision: number, signal?: AbortSignal) => read<DemoObservationRead>(id, revision, 'observation', signal),
  machine: async(id: string, revision: number, machine: string, signal?: AbortSignal) => {
    const data = await read<DemoMachineRead>(id, revision, `machines/${encodeURIComponent(machine)}`, signal);
    if (data.machineId !== machine) throw new ResearchApiError(409, 'DEMO_STALE', 'Machine mismatch');
    return data;
  },
  incident: async(id: string, revision: number, incident: string, signal?: AbortSignal) => {
    const data = await read<DemoIncidentRead>(id, revision, `incidents/${encodeURIComponent(incident)}`, signal);
    if (data.incident.incidentId !== incident || data.machine.machineId !== data.incident.machineId) throw new ResearchApiError(409, 'DEMO_STALE', 'Incident mismatch');
    return data;
  },
};
