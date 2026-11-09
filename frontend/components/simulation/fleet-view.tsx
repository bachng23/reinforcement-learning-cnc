import type { FactoryLayout } from '@/lib/simulation/factory-layouts';
import { serviceDuration } from '@/lib/simulation/clock';
import { useId, useState } from 'react';
import { Cpu, Wrench } from 'lucide-react';
import { MachineDetail, demoMachines } from './machine-detail';
import type { Config } from '@/types/generated/jcst';
import type { Lane, Matching, Simulation } from '@/lib/simulation/types';

export function FleetView({ layout, lane, config, proposal = [], compact = false, onInspect, clockSession }: { layout?: FactoryLayout; lane: Lane; config: Config; proposal?: Matching; compact?: boolean; onInspect?:(machine:number)=>void; clockSession?: Pick<Simulation,'simulation_start'|'step_seconds'> }) {
  const [selected,setSelected]=useState<number | null>(null);
  const { state } = lane;
  const markerId = useId().replaceAll(':','');
  const links = state.jobs.flatMap((job,j) => job ? [{machine:job.machine,technician:j,proposed:false}] : []);
  for (const [m,,j] of proposal) if (!state.jobs[j]) links.push({machine:m,technician:j,proposed:true});
  return <div className={`sim-fleet ${compact ? 'sim-fleet-compact' : ''}`}>
    {selected!==null&&<MachineDetail layout={layout} machine={selected} lane={lane} config={config} proposal={proposal} onClose={()=>setSelected(null)}/>}
    <div className="sim-machine-grid">{state.components.map((components,m) => {
      const job = state.jobs.find(j => j?.machine === m);
      const assignment = proposal.find(a => a[0] === m);
      const failed = components.some(c => c.failed);
      const status = job ? 'In service' : failed ? 'Breakdown' : 'Working';
      return <article key={m} className={`sim-machine ${job ? 'is-servicing' : failed ? 'is-failed' : ''}`}>
        <header><span><Cpu size={18} aria-hidden="true" /><button className="sim-machine-open" aria-label={`Inspect machine M${m+1}`} onClick={()=>onInspect?onInspect(m):setSelected(m)}>M{m+1}<span>{layout?.stations[m]?.name ?? demoMachines[m]?.name ?? 'Machine details'} ↗</span></button></span><span className="sim-state-label">{status}</span></header>
        <div className="sim-components">{components.map((c,i) => <div className={c.failed ? 'component-failed' : ''} key={i}><span>C{i+1}<strong>{c.failed ? 'FAILED' : 'Healthy'}</strong></span><span>Age <b>{c.age}</b></span></div>)}</div>
        <footer>{job ? <><Wrench size={13} aria-hidden="true" /> T{job.technician+1} · {job.kind} C{job.component+1} · {serviceDuration(job.remaining,clockSession?.step_seconds)} left</> : assignment ? <span className="sim-proposed">Proposed: T{assignment[2]+1} → C{assignment[1]+1}</span> : 'No technician assigned'}</footer>
      </article>;
    })}</div>
    {!!links.length && <svg className="sim-assignment-lines" viewBox="0 0 900 65" role="img" aria-label={links.map(l=>`T${l.technician+1} ${l.proposed?'proposed for':'servicing'} M${l.machine+1}`).join('; ')}><defs><marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#266df0" /></marker></defs>{links.map(l=>{const x1=900*(l.machine+.5)/state.components.length;const x2=900*(l.technician+.5)/state.jobs.length;return <path key={l.technician} d={`M${x2} 60 C${x2} 30 ${x1} 35 ${x1} 7`} fill="none" stroke="#266df0" strokeWidth="1.6" strokeDasharray={l.proposed?'5 4':undefined} markerEnd={`url(#${markerId})`} opacity={l.proposed?.55:.8}/>;})}</svg>}
    <div className="sim-dispatch-links" aria-label="Technician dispatch map">
      {state.jobs.map((job,j) => {
        const next = proposal.find(a => a[2] === j);
        return <div className={`sim-technician ${job ? 'is-busy' : next ? 'is-proposed' : ''}`} key={j}><span className="sim-tech-avatar"><Wrench size={17} aria-hidden="true" /></span><div><strong>T{j+1}</strong><p>{job ? `${job.kind} → M${job.machine+1}/C${job.component+1}` : next ? `Proposed → M${next[0]+1}/C${next[1]+1}` : 'Available'}</p></div><span>{job ? serviceDuration(job.remaining,clockSession?.step_seconds) : next ? `${serviceDuration(config.duration[next[0]][next[1]][j],clockSession?.step_seconds)} service` : 'Idle'}</span></div>;
      })}
    </div>
  </div>;
}
