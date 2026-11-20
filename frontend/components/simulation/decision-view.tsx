import { serviceDuration, simulationTime } from '@/lib/simulation/clock';
import { useEffect, useState } from 'react';
import type { Simulation, Matching } from '@/lib/simulation/types';
import { matchingLabel } from '@/lib/simulation/types';
import { useWorkspaceUser } from '@/lib/workspace-user';

export function DecisionView({session,busy,onDecide,automatic=false,blocked=false,workforce}: {session:Simulation;busy:boolean;blocked?:boolean;automatic?:boolean;onDecide:(action:Matching | null,reason:string)=>Promise<void>;workforce?:import('@/lib/simulation/use-technician-availability').TechnicianRead}) {
  const [reason,setReason]=useState('Approved the recommended assignments.');
  const [alternative,setAlternative]=useState('[]');
  useEffect(()=>{setAlternative('[]');},[session.id,session.pending?.tick]);
  const pending=session.pending;
  const user=useWorkspaceUser();
  const forbidden=Boolean(user&&!['ADMIN','ENGINEER'].includes(user.role));
  const invalidWorkforce=Boolean(session.technicianAvailability&&(!workforce?.rows||pending?.catalogue.some(action=>action.some(([, ,index])=>workforce.rows?.[index]?.availability!=='AVAILABLE'))||pending?.action.some(([, ,index])=>workforce.rows?.[index]?.availability!=='AVAILABLE')));
  const disabled=busy||blocked||forbidden||invalidWorkforce;
  return <section className="sim-panel sim-decision" aria-labelledby="simulation-decision-title"><div className="sim-panel-heading"><div><h2 id="simulation-decision-title">{pending ? 'Recommended assignments' : 'Maintenance proposal'}</h2><p>{pending ? 'Confirm the assignments to continue.' : session.status === 'COMPLETE' ? 'Episode completed' : 'Run the simulation to receive the next proposal.'}</p></div></div>
    {pending && <>
      {invalidWorkforce&&<p role="alert" className="sim-error">This proposal does not match current workforce availability. Refresh the session before deciding.</p>}
      {workforce?.rows?.some(row=>row.availability==='ABSENT')&&<ul className="sim-footnote">{workforce.rows.filter(row=>row.availability==='ABSENT').map(row=><li key={row.technicianIndex}>T{row.technicianIndex+1}: Technician absent · returns t{row.returnTick} ({simulationTime(session,row.returnTick!).time}). Not eligible for new assignments.</li>)}</ul>}
      {forbidden&&<p role="status" className="sim-inspection-note">Your role can inspect the simulation but cannot approve or override assignments.</p>}
      <div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Technician</th><th>Destination</th><th>Service</th><th>Duration</th></tr></thead><tbody>{pending.action.length ? pending.action.map(([m,c,j])=><tr key={j}><td>T{j+1}</td><td>M{m+1} / C{c+1}</td><td>{session.primary.state.components[m][c].failed ? 'Corrective (CM)' : 'Preventive (PM)'}</td><td>{serviceDuration(session.config.duration[m][c][j],session.step_seconds)}</td></tr>) : <tr><td colSpan={4}>No new assignments. Work already underway continues.</td></tr>}</tbody></table></div>
      <details className="sim-compatibility"><summary>Technician qualifications and service times</summary><div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Component</th>{session.primary.state.jobs.map((_,j)=><th key={j}>T{j+1}{workforce?.rows?.[j]?.availability==='ABSENT' ? ` · absent until t${workforce.rows[j].returnTick}` : session.primary.state.jobs[j] ? ' · busy' : ' · free'}</th>)}</tr></thead><tbody>{session.config.duration.flatMap((rows,m)=>rows.map((row,c)=><tr key={`${m}/${c}`}><th>M{m+1} / C{c+1}</th>{row.map((d,j)=><td key={j}>{workforce?.rows?.[j]?.availability==='ABSENT' ? `Technician absent · returns t${workforce.rows[j].returnTick}` : d ? serviceDuration(d,session.step_seconds) : 'Not qualified'}</td>)}</tr>))}</tbody></table></div></details>
      {!automatic&&<>
      <label className="sim-field">Decision reason<textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} /></label>
      <div className="sim-decision-actions"><button className="research-primary" disabled={disabled || !reason.trim()} onClick={()=>void onDecide(null,reason)}>{busy ? 'Submitting decision…' : pending.action.length ? 'Approve & dispatch' : 'Continue without dispatch'}</button>{pending.action.length > 0 && <button className="sim-button" disabled={disabled || !reason.trim() || !pending.catalogue.some(action=>action.length===0)} onClick={()=>void onDecide([],reason)}>Defer new assignments</button>}</div>
      <details className="sim-compatibility"><summary>Choose a different assignment</summary><label className="sim-field">Assignment option<select value={alternative} disabled={disabled} onChange={e=>setAlternative(e.target.value)}>{pending.catalogue.map((a,i)=><option key={i} value={JSON.stringify(a)}>{matchingLabel(a)}</option>)}</select></label><button className="sim-button" disabled={disabled || !reason.trim()} onClick={()=>void onDecide(JSON.parse(alternative),reason)}>Confirm alternative</button></details>
      </>}
    </>}
    {!!session.decisions.length && <details className="sim-compatibility"><summary>Recorded decisions ({session.decisions.length})</summary><ol className="sim-decision-history">{session.decisions.slice().reverse().map(d=><li key={d.tick}><strong>{simulationTime(session,d.tick).time} · {matchingLabel(d.action)}</strong><p>{d.override ? 'Human override' : d.actor === 'automatic' ? 'Automatic policy' : 'Policy accepted'} · {d.reason}</p></li>)}</ol></details>}
  </section>;
}
