import { useEffect, useState } from 'react';
import type { Simulation, Matching } from '@/lib/simulation/types';
import { matchingLabel } from '@/lib/simulation/types';

export function DecisionView({session,busy,onDecide,automatic=false,focusMachine,focusComponent}: {session:Simulation;busy:boolean;automatic?:boolean;focusMachine?:string;focusComponent?:string;onDecide:(action:Matching | null,reason:string)=>Promise<void>}) {
  const [reason,setReason]=useState('Accept the validated policy matching for this simulation.');
  const [alternative,setAlternative]=useState('[]');
  useEffect(()=>{setAlternative('[]');},[session.pending?.tick]);
  const pending=session.pending;
  return <section className="sim-panel sim-decision" aria-labelledby="simulation-decision-title"><div className="sim-panel-heading"><div><h2 id="simulation-decision-title">Decision Center</h2><p>{pending ? `Tick ${pending.tick}: state frozen until confirmation` : session.status === 'COMPLETE' ? 'Episode completed' : 'Run or step the simulator to the next decision boundary.'}</p></div><span className="evidence-badge">{pending ? 'Awaiting review' : 'No pending decision'}</span></div>
    {focusMachine && <p className="sim-inline-note">Opened from {focusMachine}{focusComponent ? `/${focusComponent}` : ''}. The full matching remains visible because one decision can serve multiple machines.</p>}
    {pending && <><div className="sim-recommendation"><span>Registered policy {session.primary.controller} recommends</span><strong>{matchingLabel(pending.action)}</strong><p>{pending.catalogue.length} legal complete matchings · greedy inference · checkpoint root 0 / 96k · revision {session.revision}</p></div>
      <div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Technician</th><th>Destination</th><th>Service</th><th>Duration</th></tr></thead><tbody>{pending.action.length ? pending.action.map(([m,c,j])=><tr key={j} className={focusMachine===`M${m+1}` && (!focusComponent || focusComponent===`C${c+1}`) ? "live-focused-matching" : undefined}><td>T{j+1}</td><td>M{m+1} / C{c+1}</td><td>{session.primary.state.components[m][c].failed ? 'Corrective (CM)' : 'Preventive (PM)'}</td><td>{session.config.duration[m][c][j]} ticks</td></tr>) : <tr><td colSpan={4}>WAIT. Existing technician commitments continue.</td></tr>}</tbody></table></div>
      <details className="sim-compatibility"><summary>Technician compatibility and service durations</summary><div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Component</th>{session.primary.state.jobs.map((_,j)=><th key={j}>T{j+1}{session.primary.state.jobs[j] ? ' · busy' : ' · free'}</th>)}</tr></thead><tbody>{session.config.duration.flatMap((rows,m)=>rows.map((row,c)=><tr key={`${m}/${c}`}><th>M{m+1} / C{c+1}</th>{row.map((d,j)=><td key={j}>{d ? `${d} ticks` : 'Not qualified'}</td>)}</tr>))}</tbody></table></div></details>
      {!automatic&&<>
      <label className="sim-field">Decision reason<textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} /></label>
      <div className="sim-decision-actions"><button className="research-primary" disabled={busy || !reason.trim()} onClick={()=>void onDecide(null,reason)}>{pending.action.length ? 'Approve & dispatch' : 'Approve WAIT'}</button><span>Advances one physical interval in the simulator.</span></div>
      <details className="sim-compatibility"><summary>Choose another legal matching / WAIT</summary><label className="sim-field">Alternative matching<select value={alternative} onChange={e=>setAlternative(e.target.value)}>{pending.catalogue.map((a,i)=><option key={i} value={JSON.stringify(a)}>{matchingLabel(a)}</option>)}</select></label><button className="sim-button" disabled={busy || !reason.trim()} onClick={()=>void onDecide(JSON.parse(alternative),reason)}>Confirm alternative</button></details>
      </>}
    </>}
    {!!session.decisions.length && <details className="sim-compatibility"><summary>Recorded decisions ({session.decisions.length})</summary><ol className="sim-decision-history">{session.decisions.slice().reverse().map(d=><li key={d.tick}><strong>Tick {d.tick} · {matchingLabel(d.action)}</strong><p>{d.override ? 'Human override' : d.actor === 'automatic' ? 'Automatic policy' : 'Policy accepted'} · {d.reason}</p></li>)}</ol></details>}
  </section>;
}
