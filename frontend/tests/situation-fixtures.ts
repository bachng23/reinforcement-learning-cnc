// Component/API-consumer harness, NOT a physical restore/intervention oracle.
import examples from './fixtures/situations/producer-examples.json';
import {simulationAt} from './simulation-inspection-fixtures';
import type {SnapshotMetadata,DemoSituationSession,Incident} from '@/types/generated/simulation-situations';
import type {Simulation} from '@/lib/simulation/types';
export const sourceId='10000000-0000-4000-8000-000000000001';
export const branchId='20000000-0000-4000-8000-000000000001';
export function savedSituation(tick:6|7=6):SnapshotMetadata{
  return structuredClone((tick===6?examples.inServiceSnapshot:examples.healthySnapshot).data) as SnapshotMetadata;
}
export function sourceSession(tick:6|7=6):Simulation{
  return {...simulationAt(tick),id:sourceId,revision:tick===6?12:14,status:'RUNNING',pending:null,context:{layoutId:'smt-board-assembly'}};
}
export function branchSession(tick:6|7=6):Simulation & DemoSituationSession{
  const snapshot=savedSituation(tick);return {...sourceSession(tick),id:branchId,sessionId:branchId,revision:0,tick,
    createdAt:'2026-11-16T00:00:00Z',playbackPaused:true,
    branch:{branchId,snapshotId:snapshot.snapshotId,snapshotHash:snapshot.snapshotHash,sourceSessionId:sourceId,
      sourceRevision:snapshot.sourceRevision,sourceTick:tick,branchStartTick:tick,interventionRevision:0},incidents:[],
  } as Simulation & DemoSituationSession;
}
export function injected(status:Incident['status']='APPLIED'):Incident{
  const event=structuredClone(examples.appliedIncidents.data.events[0]) as Incident;
  return {...event,status,scheduledTick:status==='SCHEDULED'?9:7,appliedTick:status==='SCHEDULED'?null:7,
    reason:status==='SKIPPED'?'MACHINE_IN_SERVICE':null};
}
