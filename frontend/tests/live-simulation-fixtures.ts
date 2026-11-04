import type { Episode } from '@/types/generated/jcst';
import type { DemoContext, DemoIncident, DemoMachineRead, DemoObservationRead, DemoIncidentRead } from '@/types/generated/demo-read';
import type { Simulation } from '@/lib/simulation/types';
import bundle from '../../contracts/jcst/v1/fixtures/engineering-bundle.json';
import examples from './fixtures/demo-read-examples.json';

// Component evidence from the producer's OpenAPI examples, never imported by production UI.
export const context = examples['/demo/sessions/{id}/factory'].available.data.context as DemoContext;
export const incidents = examples['/demo/sessions/{id}/incidents'].completedAndNewFailure.data.items as DemoIncident[];
export function simulation(): Simulation {
  const episode = bundle.episodes[0] as unknown as Episode;
  const state = structuredClone(episode.records[0].before); state.tick = 7; state.components[1][1].failed = true;
  const lane = (controller: string) => ({controller, state: structuredClone(state), records: [], total_cost: 0, controlled_cost: 0, tail_cost: 0, failures: 0, unavailable_machine_ticks: 0, technician_busy_ticks: 0, overrides: 0});
  return {id: '11111111-1111-4111-8111-111111111111', revision: 7, case_id: 'base', physical_seed: '990000001', mode: 'incident', horizon: 48, tail: 16, source_commit: 'c577b6be', config: episode.config, releases: {S: {release_id: 'S-root0-96k', sha256: 'abc'}, F: {release_id: 'F-root0-96k', sha256: 'def'}}, primary: lane('S'), baseline: lane('F'), status: 'REVIEW', activated: true, first_incident_tick: 5, pending: {tick: 7, action: [[1, 1, 0]], baseline_action: [], catalogue: [[], [[1, 1, 0]]]}, workflow: [{tick: 7, stage: 'POLICY', message: 'Registered checkpoint selected a complete matching.'}], decisions: []};
}
export function observation(session = simulation()): DemoObservationRead {
  return {sessionId: session.id, revision: session.revision, tick: session.primary.state.tick, lane: 'primary', contextStatus: 'AVAILABLE', contextVersion: context.contextVersion, contextOrigin: 'ILLUSTRATIVE_DEMO', context: structuredClone(context), status: session.status,
    machines: session.primary.state.components.map((components, index) => ({machineId: `M${index + 1}` as 'M1' | 'M2' | 'M3', simulatorMachineIndex: index, machineState: components.some(component => component.failed) ? 'BREAKDOWN' : 'WORKING', components: components.map((component, i) => ({componentId: `C${i + 1}` as 'C1' | 'C2', ageTicks: component.age, failed: component.failed})), currentJobs: []})), incidents: structuredClone(incidents), maintenanceHistory: []};
}
export function machineRead(id: string, session = simulation()): DemoMachineRead {
  const data = observation(session); const machine = data.machines.find(item => item.machineId === id)!;
  const profile = data.context!.machines.find(item => item.machineId === id)!;
  return {...data, ...machine, profile, assignedBatch: profile.assignedBatch, incidentIds: data.incidents.filter(item => item.machineId === id).map(item => item.incidentId)};
}
export function incidentRead(id: string, session = simulation()): DemoIncidentRead {
  const data = observation(session); const incident = data.incidents.find(item => item.incidentId === id)!;
  return {...data, incident, machine: data.machines.find(item => item.machineId === incident.machineId)!};
}
export const capabilities = {learned_releases: [{arm: 'S', case_id: 'base', available: true}, {arm: 'F', case_id: 'base', available: true}]};
