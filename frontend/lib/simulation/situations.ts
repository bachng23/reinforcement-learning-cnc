import { researchRequest } from '@/lib/research-api/client';
import type { CreateIncident, CreateIncidentResult, DemoSituationSession, Incident, IncidentList, SaveSnapshot, SnapshotList, SnapshotMetadata } from '@/types/generated/simulation-situations';
import type { Simulation } from './types';
import { factoryLayouts, type LayoutId } from './factory-layouts';

export class SituationDataError extends Error {
  readonly code = 'FRONTEND_CONTEXT_MISMATCH';
  constructor() { super('The situation response does not match the requested context. Reload and review again.'); }
}
// The producer example uses this workshop label; new saves persist the actual AIMS layout ID.
export function situationLayout(id: string): LayoutId | undefined {
  const known = id === 'smt-board-assembly' ? 'machining' : id;
  return factoryLayouts.find(layout => layout.id === known)?.id;
}
export function validateSnapshot(snapshot: SnapshotMetadata, expectedId?: string) {
  if (!snapshot || (expectedId && snapshot.snapshotId !== expectedId) || snapshot.schemaVersion !== 'jcst-demo-snapshot/1' ||
    snapshot.sourceSessionId !== snapshot.sessionId || snapshot.sourceRevision !== snapshot.revision || snapshot.sourceTick !== snapshot.tick ||
    !snapshot.snapshotId || !Number.isInteger(snapshot.revision) || snapshot.revision < 0 || !Number.isInteger(snapshot.tick) || snapshot.tick < 0 ||
    !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash)) throw new SituationDataError();
  return snapshot;
}
export function validateSituationSession(session: Simulation & DemoSituationSession, snapshot: SnapshotMetadata, restoring = true) {
  const branch = session?.branch;
  if (!branch || session.id !== session.sessionId || session.id === snapshot.sourceSessionId ||
    branch.branchId !== session.id || branch.snapshotId !== snapshot.snapshotId || branch.snapshotHash !== snapshot.snapshotHash ||
    branch.sourceSessionId !== snapshot.sourceSessionId || branch.sourceRevision !== snapshot.sourceRevision ||
    branch.sourceTick !== snapshot.sourceTick || branch.branchStartTick !== snapshot.sourceTick ||
    session.source_commit !== snapshot.sourceCommit || session.tick !== session.primary?.state.tick ||
    session.baseline?.state.tick !== session.tick || session.tick < snapshot.sourceTick ||
    (restoring && (session.revision !== 0 || session.tick !== snapshot.sourceTick || session.playbackPaused !== true)) ||
    !Number.isFinite(session.step_seconds) || session.step_seconds! <= 0 || !Number.isFinite(Date.parse(session.simulation_start!)) ||
    !situationLayout(snapshot.layoutId) || session.context?.layoutId !== snapshot.layoutId) throw new SituationDataError();
  return session;
}
export function validIncident(event: Incident, session: Simulation) {
  return Boolean(event?.eventId && session.primary.state.components[event.machineIndex]?.[event.componentIndex] &&
    Number.isInteger(event.scheduledTick) && ['SCHEDULED','APPLIED','SKIPPED'].includes(event.status) &&
    (event.status === 'SCHEDULED' ? event.appliedTick === null && event.reason === null && event.scheduledTick >= session.primary.state.tick :
      event.appliedTick === event.scheduledTick && event.appliedTick <= session.primary.state.tick &&
      (event.status === 'APPLIED' ? event.reason === null : ['COMPONENT_ALREADY_FAILED','MACHINE_IN_SERVICE'].includes(event.reason ?? ''))));
}
export const situationsApi = {
  async list(cursor: string | null, signal: AbortSignal) {
    const query = new URLSearchParams({limit:'20'}); if (cursor) query.set('cursor',cursor);
    const page = await researchRequest<SnapshotList>(`/demo/snapshots?${query}`,{signal});
    if (!Array.isArray(page?.items) || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new SituationDataError();
    page.items.forEach(item=>validateSnapshot(item)); return page;
  },
  async detail(id: string, signal: AbortSignal) {
    return validateSnapshot(await researchRequest<SnapshotMetadata>(`/demo/snapshots/${encodeURIComponent(id)}`,{signal}),id);
  },
  async incidents(session: Simulation, signal: AbortSignal) {
    const result = await researchRequest<IncidentList>(`/demo/sessions/${encodeURIComponent(session.id)}/incidents`,{signal});
    if (result?.sessionId !== session.id || result.revision !== session.revision || result.tick !== session.primary.state.tick ||
      result.source !== 'JCST_SIMULATION' || !Array.isArray(result.events) || new Set(result.events.map(event=>event.eventId)).size !== result.events.length ||
      result.events.some(event=>!validIncident(event,session))) throw new SituationDataError();
    return result;
  },
};

// UI command descriptions wrap the producer DTO; their `body` is sent unchanged.
export type SituationCommand = {kind:'save';sessionId:string;basisTick:number;body:SaveSnapshot} |
  {kind:'open';snapshot:SnapshotMetadata;body:{revision:number}} |
  {kind:'incident';sessionId:string;basisTick:number;body:CreateIncident};
export type SituationResult = {kind:'save';snapshot:SnapshotMetadata} |
  {kind:'open';snapshot:SnapshotMetadata;session:Simulation & DemoSituationSession} |
  {kind:'incident';session:Simulation & DemoSituationSession;event:Incident};
export type SituationExecutor = (command: SituationCommand, key: string, signal: AbortSignal) => Promise<SituationResult>;

export async function sendSituationCommand(command: SituationCommand, key: string, signal: AbortSignal): Promise<SituationResult> {
  if (command.kind === 'save') {
    const snapshot=validateSnapshot(await researchRequest<SnapshotMetadata>(`/demo/sessions/${encodeURIComponent(command.sessionId)}/snapshots`,{body:command.body,key,signal}));
    if(snapshot.sourceSessionId!==command.sessionId || snapshot.sourceRevision!==command.body.revision || snapshot.sourceTick!==command.basisTick ||
      snapshot.layoutId!==command.body.layoutId || snapshot.name!==command.body.name) throw new SituationDataError();
    return {kind:'save',snapshot};
  }
  if(command.kind==='open'){
    if(command.body.revision!==command.snapshot.sourceRevision)throw new SituationDataError();
    const session=await researchRequest<Simulation & DemoSituationSession>(`/demo/snapshots/${encodeURIComponent(command.snapshot.snapshotId)}/sessions`,{body:command.body,key,signal});
    return {kind:'open',snapshot:command.snapshot,session:validateSituationSession(session,command.snapshot)};
  }
  const result=await researchRequest<CreateIncidentResult>(`/demo/sessions/${encodeURIComponent(command.sessionId)}/incidents`,{body:command.body,key,signal});
  const session=result.session as Simulation & DemoSituationSession;
  const event=result.event;
  if(session?.id!==command.sessionId || session.sessionId!==command.sessionId || !session.branch || session.revision!==command.body.revision+1 ||
    session.tick!==command.basisTick || session.tick!==session.primary?.state.tick || session.baseline?.state.tick!==session.tick || !validIncident(event,session) ||
    event.machineIndex!==command.body.machineIndex || event.componentIndex!==command.body.componentIndex ||
    event.scheduledTick!==command.body.scheduledTick || event.requestedReason!==command.body.reason) throw new SituationDataError();
  return {kind:'incident',session,event};
}

export function situationError(error: unknown) {
  const code=(error as {code?:string})?.code; const status=(error as {status?:number})?.status;
  if(status===401 || (error as {name?:string})?.name==='AuthRedirectError')return 'Sign in to use saved situations.';
  if(status===403)return 'Your role or session scope does not allow this operation.';
  if(code==='DEMO_REVIEW_REQUIRED')return 'Resolve the pending assignments before creating an incident now.';
  if(code==='DEMO_RELEASE_UNAVAILABLE')return 'The pinned policy release is not available. This situation could not be opened.';
  if(code==='DEMO_SNAPSHOT_INCOMPATIBLE')return 'This snapshot is incompatible with the installed engine or configuration.';
  if(code==='DEMO_SCENARIO_RUNTIME_UNAVAILABLE')return 'The situation runtime is unavailable. No success has been confirmed; you can retry the same request.';
  if(code==='DEMO_BRANCH_REQUIRED')return 'Open a saved situation as a new session before creating incidents.';
  if(code==='DEMO_INCIDENT_DUPLICATE')return 'An incident already exists for this component and tick. Refresh the session to review it.';
  if(code==='FRONTEND_CONTEXT_MISMATCH')return (error as Error).message;
  if(status===409)return 'The session context changed. Refresh and confirm the snapshot or execution time again.';
  if(status===404)return 'Saved situations or incidents are not available in this scope or API version.';
  if(status===503 || status===504)return 'The service is unavailable or timed out. Retry keeps the same request key.';
  if(status===422)return 'The target or scheduled tick is outside the simulator limits. Refresh and review the form.';
  return 'The response was not received. Retry with unchanged details to recover the same operation.';
}
