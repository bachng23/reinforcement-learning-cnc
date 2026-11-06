import { serviceDuration, simulationTime } from '@/lib/simulation/clock';
import { useEffect, useState } from 'react';
import type { Simulation, Matching } from '@/lib/simulation/types';
import { matchingLabel } from '@/lib/simulation/types';

export function DecisionView({session,busy,onDecide,automatic=false}: {session:Simulation;busy:boolean;automatic?:boolean;onDecide:(action:Matching | null,reason:string)=>Promise<void>}) {
  const [reason,setReason]=useState('Approved the recommended assignments.');
  const [alternative,setAlternative]=useState('[]');
  useEffect(()=>{setAlternative('[]');},[session.pending?.tick]);
  const pending=session.pending;
  return <section className="sim-panel sim-decision" aria-labelledby="simulation-decision-title"><div className="sim-panel-heading"><div><h2 id="simulation-decision-title">{pending ? 'Recommended assignments' : 'Maintenance proposal'}</h2><p>{pending ? 'Confirm the assignments to continue.' : session.status === 'COMPLETE' ? 'Episode completed' : 'Run the simulation to receive the next proposal.'}</p></div></div>
    {pending && <>
      <div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Technician</th><th>Destination</th><th>Service</th><th>Duration</th></tr></thead><tbody>{pending.action.length ? pending.action.map(([m,c,j])=><tr key={j}><td>T{j+1}</td><td>M{m+1} / C{c+1}</td><td>{session.primary.state.components[m][c].failed ? 'Corrective (CM)' : 'Preventive (PM)'}</td><td>{serviceDuration(session.config.duration[m][c][j],session.step_seconds)}</td></tr>) : <tr><td colSpan={4}>No new assignments. Work already underway continues.</td></tr>}</tbody></table></div>
      <details className="sim-compatibility"><summary>Technician qualifications and service times</summary><div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Component</th>{session.primary.state.jobs.map((_,j)=><th key={j}>T{j+1}{session.primary.state.jobs[j] ? ' · busy' : ' · free'}</th>)}</tr></thead><tbody>{session.config.duration.flatMap((rows,m)=>rows.map((row,c)=><tr key={`${m}/${c}`}><th>M{m+1} / C{c+1}</th>{row.map((d,j)=><td key={j}>{d ? serviceDuration(d,session.step_seconds) : 'Not qualified'}</td>)}</tr>))}</tbody></table></div></details>
      {!automatic&&<>
      <label className="sim-field">Decision reason<textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} /></label>
      <div className="sim-decision-actions"><button className="research-primary" disabled={busy || !reason.trim()} onClick={()=>void onDecide(null,reason)}>{pending.action.length ? 'Approve & dispatch' : 'Continue without dispatch'}</button></div>
      <details className="sim-compatibility"><summary>Choose a different assignment</summary><label className="sim-field">Assignment option<select value={alternative} onChange={e=>setAlternative(e.target.value)}>{pending.catalogue.map((a,i)=><option key={i} value={JSON.stringify(a)}>{matchingLabel(a)}</option>)}</select></label><button className="sim-button" disabled={busy || !reason.trim()} onClick={()=>void onDecide(JSON.parse(alternative),reason)}>Confirm alternative</button></details>
      </>}
    </>}
    {!!session.decisions.length && <details className="sim-compatibility"><summary>Recorded decisions ({session.decisions.length})</summary><ol className="sim-decision-history">{session.decisions.slice().reverse().map(d=><li key={d.tick}><strong>{simulationTime(session,d.tick).time} · {matchingLabel(d.action)}</strong><p>{d.override ? 'Human override' : d.actor === 'automatic' ? 'Automatic policy' : 'Policy accepted'} · {d.reason}</p></li>)}</ol></details>}
  </section>;
}
