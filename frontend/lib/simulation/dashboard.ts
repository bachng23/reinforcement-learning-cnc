import type { Simulation } from './types';
export function factoryMetrics(session: Simulation) {
  const lane=session.primary, machines=lane.state.components.length, technicians=lane.state.jobs.length;
  const records=lane.records, elapsed=lane.state.tick, hours=(session.step_seconds??900)/3600;
  const events=records.flatMap(r=>r.events);
  const costKeys=['preventive','corrective','unavailable','failure'] as const;
  const costs=costKeys.map(key=>({key,value:records.reduce((sum,r)=>sum+(r.breakdown[key]??0),0)}));
  const stationMetrics=lane.state.components.map((components,m)=>{
    const job=lane.state.jobs.find(j=>j?.machine===m);
    const downtime=records.filter(r=>r.before.components[m].some(c=>c.failed)||r.events.some(e=>e.type==='occupancy'&&e.machine===m)).length;
    return {machine:m,status:job?'In service':components.some(c=>c.failed)?'Breakdown':'Working',
      failures:events.filter(e=>e.type==='failure'&&e.machine===m).length,
      availability:records.length?100*(1-downtime/records.length):null,
      downtimeHours:downtime*hours,job};
  });
  const workers=lane.state.jobs.map((job,j)=>({technician:j,job,
    busy:events.filter(e=>e.type==='occupancy'&&e.technician===j).length,
    completed:lane.completed_jobs?.[j]??events.filter(e=>e.type==='completion'&&e.technician===j).length,
    corrective:events.filter(e=>e.type==='start'&&e.kind==='CM'&&e.technician===j).length,
    preventive:events.filter(e=>e.type==='start'&&e.kind==='PM'&&e.technician===j).length,
  }));
  const binSize=Math.max(1,Math.ceil(records.length/12));
  const bins=Array.from({length:Math.ceil(records.length/binSize)},(_,i)=>{
    const rows=records.slice(i*binSize,(i+1)*binSize);
    let working=0,service=0,down=0,failures=0,cost=0;
    for(const row of rows){
      for(let m=0;m<machines;m++){
        if(row.events.some(e=>e.type==='occupancy'&&e.machine===m))service++;
        else if(row.before.components[m].some(c=>c.failed))down++;else working++;
      }
      failures+=row.events.filter(e=>e.type==='failure').length;cost+=row.cost;
    }
    return {tick:rows.at(-1)!.after.tick,working:working/(rows.length*machines),service:service/(rows.length*machines),down:down/(rows.length*machines),failures,cost};
  });
  return {elapsed,hours,records,events,costs,stations:stationMetrics,workers,bins,
    availability:elapsed?100*(1-lane.unavailable_machine_ticks/(elapsed*machines)):null,
    utilization:elapsed?100*lane.technician_busy_ticks/(elapsed*technicians):null,
    preventive:events.filter(e=>e.type==='start'&&e.kind==='PM').length,
    corrective:events.filter(e=>e.type==='start'&&e.kind==='CM').length,
    recentFailures:events.filter(e=>e.type==='failure').length,
  };
}

/** Conditional per-operating-interval Weibull hazard, matching the pinned engine. */
export function operatingRisk(age:number,spec:{scale:number;shape:number}) {
  return -Math.expm1(-(((age+1)/spec.scale)**spec.shape-(age/spec.scale)**spec.shape));
}
