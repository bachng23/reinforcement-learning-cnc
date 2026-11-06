import type { FactoryLayout } from '@/lib/simulation/factory-layouts';
import { simulationTime } from '@/lib/simulation/clock';
import type { Simulation } from '@/lib/simulation/types';
import { FleetView } from './fleet-view';

export function ComparisonView({ session, layout }: { session: Simulation; layout?:FactoryLayout }) {
  const values = [session.primary,session.baseline].map(lane => ({...lane,
    total_cost:lane.total_cost-(lane.comparison_start?.total_cost??0),
    failures:lane.failures-(lane.comparison_start?.failures??0),
    unavailable_machine_ticks:lane.unavailable_machine_ticks-(lane.comparison_start?.downtime??0),
  }));
  const [a,b]=values;
  const xStart=Math.max(...values.map(lane=>Math.max(lane.comparison_start?.tick??0,lane.records[0]?.tick??0)));
  const xEnd=Math.max(xStart+1,session.continuous?session.primary.state.tick:session.horizon+session.tail);
  const delta = a.total_cost - b.total_cost;
  const label = `${a.controller}${a.overrides ? ' + human override' : ''}`;
  const series = [a,b].map(lane => { const records=lane.records.filter(r=>r.tick>=xStart); let total=lane.total_cost-records.reduce((sum,r)=>sum+r.cost,0); return [{x:xStart,y:total},...records.map(r=>({x:r.tick+1,y:total+=r.cost}))]; });
  const max = Math.max(1,...series.flatMap(s=>s.map(p=>p.y)));
  return <div className="sim-comparison">
    <section className="sim-panel"><div className="sim-panel-heading"><div><h2>Simulation results</h2></div><span className="evidence-badge">{session.status === 'COMPLETE' ? 'Complete' : 'In progress'}</span></div>
      <table className="sim-metrics-table"><thead><tr><th>Measure</th><th>{label}</th><th>{b.controller}</th></tr></thead><tbody>
        {[['Total cost (points)',a.total_cost,b.total_cost],['Component failures',a.failures,b.failures],['Machine downtime (hours)',(a.unavailable_machine_ticks*(session.step_seconds??900)/3600).toFixed(1),(b.unavailable_machine_ticks*(session.step_seconds??900)/3600).toFixed(1)],['Technician time (hours)',(a.technician_busy_ticks*(session.step_seconds??900)/3600).toFixed(1),(b.technician_busy_ticks*(session.step_seconds??900)/3600).toFixed(1)]].map(([name,x,y])=><tr key={name}><th>{name}</th><td>{x}</td><td>{y}</td></tr>)}
      </tbody></table>
      <div className="sim-delta"><span>Cost difference · {label} − {b.controller}</span><strong>{delta > 0 ? '+' : ''}{delta.toFixed(0)}</strong><span>{delta < 0 ? `${label} has lower cost in this run` : delta > 0 ? `${b.controller} has lower cost in this run` : 'Equal cost so far'}</span></div>
      <details className="sim-compatibility">
        <summary>Run details</summary>
        <p className="sim-footnote">Results are for one simulation run. Downtime includes breakdowns and maintenance.</p>
        {a.overrides > 0 && <p className="sim-footnote">Manual changes to {a.controller} assignments: {a.overrides}</p>}
        <p className="sim-footnote">Cost during controller operation: {a.controlled_cost} / {b.controlled_cost} points</p>
        {!session.continuous && <p className="sim-footnote">Cost under the shared end-of-run rule: {a.tail_cost} / {b.tail_cost} points</p>}
        {session.continuous && <p className="sim-footnote">Continuous operation. Recent chart history is retained for 256 steps; totals cover all operation since the policy selection. Policies retain the existing machine conditions when changed.</p>}
        {session.audits && <p className="sim-footnote">Replay verification: {a.controller} {session.audits.primary.status}, {b.controller} {session.audits.baseline.status}</p>}
      </details>
    </section>
    <figure className="sim-panel sim-cost-chart"><figcaption><strong>Cumulative cost</strong><span><i /> {label} <i className="baseline" /> {b.controller}</span></figcaption><svg viewBox="0 0 880 235" role="img" aria-label="Actual cumulative simulation cost, primary and baseline"><path d="M45 15 V200 H850" fill="none" stroke="#cad0d9" />{[0,.5,1].map(t=><g key={t}><text x="35" y={204-180*t} textAnchor="end" fontSize="11" fill="#626873">{(max*t).toFixed(0)}</text><path d={`M45 ${200-180*t} H850`} stroke="#eeeff1" /></g>)}{series.map((rows,i)=><polyline key={i} fill="none" stroke={i ? '#8c5ab5' : '#266df0'} strokeWidth="2.5" strokeDasharray={i ? '6 4' : undefined} points={rows.map(p=>`${45+805*(p.x-xStart)/(xEnd-xStart)},${200-180*p.y/max}`).join(' ')} />)}<text x="45" y="225" fontSize="11">{simulationTime(session,xStart).time}</text><text x="850" y="225" fontSize="11" textAnchor="end">{simulationTime(session,xEnd).date} · {simulationTime(session,xEnd).time}</text></svg></figure>
    <details className="sim-panel sim-compatibility"><summary>Machine states by controller</summary><div className="sim-comparison-fleets">{[a,b].map((lane,i)=><section className="sim-panel" key={i}><div className="sim-panel-heading"><h2>{i ? lane.controller : label} · {simulationTime(session,lane.state.tick).time}</h2></div><FleetView layout={layout} lane={lane} config={session.config} compact /></section>)}</div></details>
  </div>;
}
