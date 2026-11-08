import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { ReviewDialog } from '@/components/research/review-dialog';
import { factoryLayouts, type FactoryLayout } from '@/lib/simulation/factory-layouts';
import type { Config } from '@/types/generated/jcst';
import { serviceDuration, simulationTime } from '@/lib/simulation/clock';
import type { Simulation, Lane, Matching } from '@/lib/simulation/types';

// Presentation context only. These labels do not enter JCST policy observations.
export const demoMachines = factoryLayouts[0].stations.map((station,index)=>({
  name:station.name,operation:station.operation,product:factoryLayouts[0].product,
  batch:'Current simulation',position:`${factoryLayouts[0].name} · Station ${index+1}`,
}));
export function MachineDetail({machine,lane,config,proposal,onClose,decisionAction,clockSession,layout}:{layout?:FactoryLayout;clockSession?:Pick<Simulation,'simulation_start'|'step_seconds'>;machine:number;lane:Lane;config:Config;proposal:Matching;onClose:()=>void;decisionAction?:ReactNode}) {
  const info=layout ? {...layout.stations[machine],product:layout.product,batch:'Current simulation',position:`${layout.name} · Station ${machine+1}`} : demoMachines[machine];const components=lane.state.components[machine];
  const job=lane.state.jobs.find(j=>j?.machine===machine);const next=proposal.find(a=>a[0]===machine);
  const status=job?'In service':components.some(c=>c.failed)?'Breakdown':'Working';
  const title=`machine-detail-${machine}`;
  return <ReviewDialog labelledBy={title} busy={false} onClose={onClose}><div className="sim-machine-detail">
    <header><div><p className="research-eyebrow">Machine M{machine+1} · {status} · {simulationTime(clockSession??{},lane.state.tick).time}</p><h2 id={title}>{info?.name ?? `Machine M${machine+1}`}</h2></div><button className="sim-button" aria-label="Close machine details" onClick={onClose}><X size={17} aria-hidden="true"/></button></header>
    <dl className="sim-machine-facts"><div><dt>Production line</dt><dd>{info?'Line P1':'Not configured'}</dd></div><div><dt>Operation</dt><dd>{info?.operation??'Not configured'}</dd></div><div><dt>Assigned batch</dt><dd>{info?.batch??'Not configured'}</dd></div><div><dt>Product</dt><dd>{info?.product??'Not configured'}</dd></div><div><dt>Factory location</dt><dd>{info?.position??'Not configured'}</dd></div><div><dt>Current service</dt><dd>{job?`T${job.technician+1} · ${job.kind} · ${serviceDuration(job.remaining,clockSession?.step_seconds)} left`:next?`Proposed T${next[2]+1} → C${next[1]+1}`:'No technician assigned'}</dd></div></dl>
    {decisionAction&&<div className="sim-machine-decision">{decisionAction}</div>}
    <h3>Components</h3><table className="sim-metrics-table"><thead><tr><th>Component</th><th>Condition</th><th>Age</th><th>Service time by technician</th></tr></thead><tbody>{components.map((c,i)=><tr key={i}><th>C{i+1}</th><td>{c.failed?'FAILED':'Healthy'}</td><td>{serviceDuration(c.age,clockSession?.step_seconds)}</td><td>{config.duration[machine][i].map((d,j)=>`T${j+1}: ${d?serviceDuration(d,clockSession?.step_seconds):'not qualified'}`).join(' · ')}</td></tr>)}</tbody></table>
    <h3>Recent activity</h3><ul className="sim-event-list">{lane.records.flatMap(r=>r.events).filter(e=>e.machine===machine&&e.type!=='occupancy').slice(-6).reverse().map((e,i)=><li key={i}>{simulationTime(clockSession??{},e.tick).time} · {e.type} · C{e.component+1}{e.technician==null?'':` · T${e.technician+1}`}</li>)}</ul>{!lane.records.some(r=>r.events.some(e=>e.machine===machine&&e.type!=='occupancy'))&&<p className="sim-footnote">No recorded events for this machine yet.</p>}
  </div></ReviewDialog>;
}
