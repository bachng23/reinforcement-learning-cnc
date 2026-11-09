import type { DemoWorkOrder, DemoWorkOrders } from '@/types/simulation-work-orders';
import type { Simulation } from '@/lib/simulation/types';
import { serviceDuration, simulationTime } from '@/lib/simulation/clock';

const assignmentLabels: Record<DemoWorkOrder['assignmentSource'], string> = {
  AUTOMATIC: 'Automatic',
  MANUAL_APPROVAL: 'Manually approved',
  OVERRIDE: 'Override',
  UNKNOWN: 'Unavailable',
};

export function MachineServices({ workOrders, session }: { workOrders: DemoWorkOrders; session: Simulation }) {
  const { items, stepSeconds, total } = workOrders;
  const time = (tick: number | null) => tick === null ? 'Unavailable' : `t${tick} · ${simulationTime(session, tick).time}`;
  const duration = (ticks: number | null) => ticks === null ? 'Unavailable' : serviceDuration(ticks, stepSeconds);
  return <section className="sim-health-section" aria-labelledby="machine-services-title">
    <h3 id="machine-services-title">Maintenance work and history</h3>
    <p className="sim-footnote">Simulator work orders for this session and machine.</p>
    {items.length ? <ul className="sim-service-list">{items.map(order => {
      const active = order.status === 'IN_PROGRESS';
      return <li key={order.workOrderId} className="sim-service-card" data-testid="service-record" data-work-order-id={order.workOrderId}>
        <header>
          <strong>T{order.technicianIndex + 1} · C{order.componentIndex + 1} · {order.kind}</strong>
          <span className="sim-twin-status" data-status={active ? 'In service' : 'Completed'}>{active ? 'In progress' : 'Completed'}</span>
        </header>
        <dl>
          <div><dt>Time remaining</dt><dd>{duration(order.remainingTicks)}</dd></div>
          <div><dt>Started</dt><dd>{time(order.startedTick)}</dd></div>
          <div><dt>Completed</dt><dd>{time(order.completedTick)}</dd></div>
          <div><dt>Wait before service</dt><dd>{duration(order.waitTicks)}</dd></div>
          <div><dt>Assignment source</dt><dd>{assignmentLabels[order.assignmentSource]}</dd></div>
        </dl>
      </li>;
    })}</ul> : <p className="sim-inspection-note">No maintenance work recorded for this machine in the available session history. A deferred decision does not create a work order.</p>}
    {total > items.length && <p className="sim-footnote">Showing the latest {items.length} of {total} work orders.</p>}
    {workOrders.historyCoverage === 'PARTIAL' && <p className="sim-footnote">Partial work-order history: some legacy service records are unavailable.</p>}
  </section>;
}
