import { Activity, AlertTriangle, ArrowUpRight, Clock3, Wrench } from 'lucide-react';
import type { Simulation } from '@/lib/simulation/types';
import type { FactoryLayout } from '@/lib/simulation/factory-layouts';
import { factoryMetrics, operatingRisk } from '@/lib/simulation/dashboard';
import { policyNames, simulationTime, serviceDuration } from '@/lib/simulation/clock';
const palette=['#497eae','#5e9f91','#d0a04d','#c36772'];
const costNames:Record<string,string>={preventive:'Preventive service',corrective:'Corrective service',unavailable:'Machine unavailability',failure:'Failure penalty'};
const percent=(n:number|null)=>n===null?'—':`${n.toFixed(1)}%`;

export function FactoryDashboard({session,layout,onSelectMachine}:{session:Simulation;layout:FactoryLayout;onSelectMachine:(m:number)=>void}) {
  const data=factoryMetrics(session),lane=session.primary;
  const clock=simulationTime(session,lane.state.tick);
  const recentStart=data.records[0]?.tick??0;
  const costTotal=data.costs.reduce((sum,c)=>sum+c.value,0);
  const dominant=[...data.costs].sort((a,b)=>b.value-a.value)[0];
  const mostFailures=[...data.stations].sort((a,b)=>b.failures-a.failures)[0];
  const busiest=[...data.workers].sort((a,b)=>b.busy-a.busy)[0];
  const pending=data.stations.filter(s=>s.status==='Breakdown');
  const mixTotal=data.preventive+data.corrective;
  const maxFailures=Math.max(1,...data.bins.map(b=>b.failures));
  return <div className="factory-dashboard">
    <div className="fd-context"><span><Activity size={14}/>{policyNames[lane.controller]}</span><time dateTime={clock.iso}>{clock.date} · {clock.time}</time><span>{serviceDuration(lane.state.tick,session.step_seconds)} simulated operation</span></div>
    <div className="fd-kpis">
      {[
        {title:'Machine availability',value:percent(data.availability),note:'Working machine-time / total machine-time',icon:Activity},
        {title:'Component failures',value:String(lane.failures),note:`${data.stations.filter(s=>s.status==='Breakdown').length} machines awaiting service`,icon:AlertTriangle},
        {title:'Operating cost',value:lane.total_cost.toLocaleString('en-GB',{maximumFractionDigits:0}),note:'Simulation cost points · lifetime',icon:Clock3},
        {title:'Technician utilization',value:percent(data.utilization),note:`${lane.state.jobs.filter(Boolean).length} of ${lane.state.jobs.length} technicians occupied now`,icon:Wrench},
      ].map(({title,value,note,icon:Icon})=><article className="fd-kpi" key={title}><div><span>{title}</span><Icon size={16}/></div><strong>{value}</strong><p>{note}</p></article>)}
    </div>
    <div className="fd-insights" aria-label="Operational insights">
      <article data-alert={pending.length>0}><span>Attention now</span><strong>{pending.length?`${pending.map(s=>`M${s.machine+1}`).join(', ')} awaiting maintenance`:'No machines awaiting maintenance'}</strong><p>{pending.length?'Open the simulation to review technician assignments.':`${data.stations.filter(s=>s.status==='In service').length} machines in service; commitments remain active.`}</p></article>
      <article><span>Reliability focus</span><strong>{data.recentFailures?`M${mostFailures.machine+1} · ${mostFailures.failures} recent failures`:'No failure history yet'}</strong><p>{data.recentFailures?`${layout.stations[mostFailures.machine]?.name} accounts for ${(100*mostFailures.failures/data.recentFailures).toFixed(0)}% of failures in the visible window.`:'Run the simulation to reveal which stations need attention.'}</p></article>
      <article><span>Largest cost driver</span><strong>{costTotal?costNames[dominant.key]:'No operating cost yet'}</strong><p>{costTotal?`${(100*dominant.value/costTotal).toFixed(0)}% of cost in the visible window · ${dominant.value.toFixed(0)} points.`:'Costs appear when the simulator advances.'}</p></article>
    </div>
    <p className="fd-window">Charts and station details cover {data.records.length} retained steps: {simulationTime(session,recentStart).date} {simulationTime(session,recentStart).time} – {clock.date} {clock.time}. Top metrics cover the full session.</p>
    <div className="fd-chart-grid">
      <section className="fd-card fd-wide"><header><div><h2>Machine state over time</h2><p>Share of machine-time working, under maintenance or stopped</p></div><div className="fd-legend"><span><i style={{background:'#5e9f91'}}/>Working</span><span><i style={{background:'#497eae'}}/>In service</span><span><i style={{background:'#c36772'}}/>Breakdown</span></div></header>
        {data.bins.length?<svg viewBox="0 0 660 200" role="img" aria-label="Machine state distribution over simulated time">
          {[0,.5,1].map(t=><g key={t}><path d={`M40 ${160-t*130} H640`} stroke="#e6eaf0"/><text x="33" y={164-t*130} textAnchor="end">{t*100}%</text></g>)}
          {data.bins.map((bin,i)=>{const width=590/data.bins.length;return <g key={bin.tick}>
            <rect x={44+i*width} y={160-bin.working*130} width={Math.max(1,width-6)} height={bin.working*130} fill="#5e9f91"><title>Working {(bin.working*100).toFixed(1)}%</title></rect>
            <rect x={44+i*width} y={160-(bin.working+bin.service)*130} width={Math.max(1,width-6)} height={bin.service*130} fill="#497eae"><title>Maintenance {(bin.service*100).toFixed(1)}%</title></rect>
            <rect x={44+i*width} y={30} width={Math.max(1,width-6)} height={bin.down*130} fill="#c36772"><title>Breakdown {(bin.down*100).toFixed(1)}%</title></rect>
            {(i===0||i===data.bins.length-1||i===Math.floor(data.bins.length/2))&&<text x={44+i*width} y="185">{simulationTime(session,bin.tick).time}</text>}
          </g>;})}
        </svg>:<EmptyChart/>}
      </section>
      <section className="fd-card"><header><div><h2>Cost composition</h2><p>Actual simulator cost breakdown</p></div></header>
        <div className="fd-cost-composition"><svg viewBox="0 0 120 120" role="img" aria-label="Share of preventive, corrective, unavailability and failure cost"><circle cx="60" cy="60" r="43" fill="none" stroke="#e9edf2" strokeWidth="13"/>{data.costs.map((cost,i)=>{const before=data.costs.slice(0,i).reduce((sum,c)=>sum+c.value,0);return costTotal>0?<circle key={cost.key} cx="60" cy="60" r="43" fill="none" stroke={palette[i]} strokeWidth="13" pathLength="100" strokeDasharray={`${100*cost.value/costTotal} 100`} strokeDashoffset={-100*before/costTotal} transform="rotate(-90 60 60)"><title>{costNames[cost.key]}: {cost.value.toFixed(0)} points</title></circle>:null;})}<text x="60" y="58" textAnchor="middle" className="fd-donut-total">{costTotal.toFixed(0)}</text><text x="60" y="73" textAnchor="middle">points</text></svg>
        <ul>{data.costs.map((cost,i)=><li key={cost.key}><span><i style={{background:palette[i]}}/>{costNames[cost.key]}</span><strong>{cost.value.toFixed(0)}</strong></li>)}</ul></div>
      </section>
      <section className="fd-card"><header><div><h2>Failure frequency</h2><p>Component failures per time window</p></div><strong className="fd-card-total">{data.recentFailures}<small> failures</small></strong></header>
        {data.bins.length?<svg viewBox="0 0 500 180" role="img" aria-label="Component failure counts across recent time windows">
          <path d="M30 20 V140 H480" fill="none" stroke="#dce3eb"/>
          <polyline points={data.bins.map((b,i)=>`${40+i*430/Math.max(1,data.bins.length-1)},${137-b.failures/maxFailures*107}`).join(' ')} fill="none" stroke="#bd6572" strokeWidth="2.5"/>
          {data.bins.map((b,i)=><g key={b.tick}><circle cx={40+i*430/Math.max(1,data.bins.length-1)} cy={137-b.failures/maxFailures*107} r="3.5" fill="#bd6572"><title>{simulationTime(session,b.tick).time}: {b.failures} failures</title></circle><text x={40+i*430/Math.max(1,data.bins.length-1)} y={125-b.failures/maxFailures*107} textAnchor="middle">{b.failures}</text></g>)}
          <text x="30" y="164">{simulationTime(session,recentStart).time}</text><text x="480" y="164" textAnchor="end">{clock.time}</text>
        </svg>:<EmptyChart/>}
      </section>
      <section className="fd-card"><header><div><h2>Technician workload</h2><p>Occupied time in the visible window</p></div></header>
        <div className="fd-worker-list">{data.workers.map(worker=>{const used=data.records.length?100*worker.busy/data.records.length:0;return <div key={worker.technician}><div><strong>T{worker.technician+1}</strong><span>{worker.job?`M${worker.job.machine+1} / C${worker.job.component+1} · ${serviceDuration(worker.job.remaining,session.step_seconds)} left`:'Available'}<b>{used.toFixed(0)}%</b></span></div><div className="fd-track"><span style={{width:`${used}%`}}/></div><small>{worker.completed} jobs completed over the full session</small></div>;})}</div>
        <p className="fd-card-note">{busiest?.busy?`T${busiest.technician+1} has the highest occupied time: ${serviceDuration(busiest.busy,session.step_seconds)}.`:'No technician occupancy recorded yet.'}</p>
      </section>
      <section className="fd-card"><header><div><h2>Maintenance approach</h2><p>New assignments · preventive vs corrective</p></div></header>
        <div className="fd-maintenance-counts"><div><strong>{data.preventive}</strong><span>Preventive</span></div><div><strong>{data.corrective}</strong><span>Corrective</span></div></div>
        <div className="fd-mix-track" role="img" aria-label={`${data.preventive} preventive and ${data.corrective} corrective assignments`}><span style={{width:`${mixTotal?100*data.preventive/mixTotal:0}%`}}/><span style={{width:`${mixTotal?100*data.corrective/mixTotal:0}%`}}/></div>
        <p className="fd-card-note">{mixTotal?`${(100*data.preventive/mixTotal).toFixed(0)}% of assignments started before component failure. Preventive servicing also consumes machine-time.`:'No maintenance assignments have started yet.'}</p>
      </section>
      <section className="fd-card"><header><div><h2>Component condition</h2><p>Current state and risk on the next operating interval</p></div></header>
        <div className="fd-condition-map">{lane.state.components.map((components,m)=><div key={m}><strong>M{m+1}</strong>{components.map((component,c)=>{
          const servicing=lane.state.jobs.some(job=>job?.machine===m&&job.component===c);
          const risk=operatingRisk(component.age,session.config.components[m][c]);
          return <button key={c} data-condition={servicing?'service':component.failed?'failed':risk>=.25?'watch':'healthy'} onClick={()=>onSelectMachine(m)} aria-label={`Inspect M${m+1} component C${c+1}`}>
            <span>C{c+1}<b>{servicing?'In service':component.failed?'Failed':`${(risk*100).toFixed(1)}% risk`}</b></span>
            <small>Age {serviceDuration(component.age,session.step_seconds)}</small>
          </button>;
        })}</div>)}</div>
        <p className="fd-card-note">Risk applies when a machine operates. Machines under maintenance or stopped do not accumulate operating failures.</p>
      </section>
      <section className="fd-card fd-stations"><header><div><h2>Station reliability</h2><p>Inspect current condition and recent station performance</p></div></header>
        <div className="fd-table-scroll"><table><thead><tr><th>Station</th><th>Current state</th><th>Availability</th><th>Failures</th><th>Downtime</th><th aria-label="Inspect station"/></tr></thead><tbody>{data.stations.map(station=><tr key={station.machine}><th><span>M{station.machine+1}</span>{layout.stations[station.machine]?.name}</th><td><span className="sim-twin-status" data-status={station.status}>{station.status}</span></td><td>{percent(station.availability)}</td><td>{station.failures}</td><td>{station.downtimeHours.toFixed(1)} h</td><td><button className="sim-button" aria-label={`Open M${station.machine+1} in simulation`} onClick={()=>onSelectMachine(station.machine)}><ArrowUpRight size={15}/></button></td></tr>)}</tbody></table></div>
      </section>
    </div>
  </div>;
}
function EmptyChart(){return <div className="fd-empty"><Activity size={24}/><p>Run the simulation to build this chart.</p></div>;}
