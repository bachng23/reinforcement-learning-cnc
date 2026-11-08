import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { simulationTime } from '@/lib/simulation/clock';
import { matchingLabel, type Simulation } from '@/lib/simulation/types';

export function SimulationActivity({ session, onInspect }: { session: Simulation; onInspect: (machine: number) => void }) {
  return <section className="sim-panel sim-agent-workflow" aria-label="Simulation activity"><div className="sim-panel-heading"><h2>Activity log</h2></div>
    {!!session.decisions.length && <><h3>Recorded decisions</h3><ol className="sim-decision-history">{session.decisions.slice().reverse().map((decision, index) => {
      const machines = [...new Set((decision.action.length ? decision.action : decision.proposed_action).map(([machine]) => machine))];
      return <li key={`${decision.tick}:${index}`}><strong>{simulationTime(session, decision.tick).time} · {decision.action.length ? decision.override ? 'Assignments overridden' : 'Assignments approved' : 'Maintenance deferred — no new service dispatched'}</strong>
        <p>{matchingLabel(decision.action)} · {decision.reason}</p><p>Actor: {decision.actor}</p>
        {machines.map(machine => <button className="sim-button" key={machine} onClick={() => onInspect(machine)}>Inspect M{machine + 1}<ArrowRight size={13} aria-hidden="true" /></button>)}
      </li>;
    })}</ol></>}
    {!session.workflow.length && !session.decisions.length && <p className="sim-footnote">No decisions recorded yet.</p>}
    <ol className="sim-workflow">{session.workflow.slice().reverse().map((entry, index) => <li key={`${entry.tick}:${entry.stage}:${index}`}><span className="sim-workflow-tick">{simulationTime(session, entry.tick).time}</span><div><strong>{entry.stage.replaceAll('_', ' ')}</strong><p>{entry.message}</p></div><CheckCircle2 size={16} aria-hidden="true" /></li>)}</ol>
  </section>;
}
