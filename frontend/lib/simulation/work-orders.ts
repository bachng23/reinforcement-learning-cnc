import { researchRequest } from '@/lib/research-api/client';
import type { DemoWorkOrders } from '@/types/simulation-work-orders';
import { InspectionMismatch } from './machine-health';
import type { Simulation } from './types';

export async function readMachineWorkOrders(snapshot: Simulation, machine: number, signal: AbortSignal) {
  const workOrders = await researchRequest<DemoWorkOrders>(
    `/demo/sessions/${encodeURIComponent(snapshot.id)}/work-orders?machineIndex=${machine}`,
    { signal },
  );
  const state = snapshot.primary.state;
  const components = state.components[machine];
  if (workOrders?.contractVersion !== 'jcst-work-orders/v1' ||
      workOrders.sessionId !== snapshot.id || workOrders.revision !== snapshot.revision ||
      workOrders.tick !== state.tick || workOrders.stepSeconds !== (snapshot.step_seconds ?? 900) ||
      workOrders.lane !== 'primary' || workOrders.source !== 'JCST_SIMULATION' ||
      !Array.isArray(workOrders.items) || !components ||
      workOrders.items.some(order => order.machineIndex !== machine ||
        !components[order.componentIndex] || !Number.isInteger(order.technicianIndex) ||
        order.technicianIndex < 0 || order.technicianIndex >= state.jobs.length)) {
    throw new InspectionMismatch();
  }
  return workOrders;
}
