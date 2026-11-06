import type { FactoryLayout } from './factory-layouts';
type Position = [number, number];
/** Walk around machine bodies and conveyors; never cut through a production cell. */
export function technicianRoute(layout: FactoryLayout, from: Position, to: Position): Position[] {
  const unit=.25, width=97, height=73;
  const cell=([x,z]:Position):Position=>[Math.round((x+12)/unit),Math.round((z+9)/unit)];
  const world=([x,z]:Position):Position=>[x*unit-12,z*unit-9];
  const key=([x,z]:Position)=>z*width+x;
  const start=cell(from);
  let end=cell(to);
  const blocked=([cx,cz]:Position)=>{
    const [x,z]=world([cx,cz]);
    const output=layout.route.at(-1)!,input=layout.route[0];
    if(layout.payload==='smt-pcb'&&Math.abs(x-input.x)<.9&&Math.abs(z-input.z+1.05)<.8)return true;
    if ((Math.abs(x+9)<1.1&&Math.abs(z+5.5)<.65)||(Math.abs(x-output.x)<1.1&&Math.abs(z-output.z-1.4)<.65))return true;
    if(layout.stations.some(s=>Math.abs(x-s.x)<1.55&&Math.abs(z-s.z)<1.04))return true;
    return layout.route.slice(1).some((b,i)=>{
      const a=layout.route[i];
      return x>Math.min(a.x,b.x)-.56&&x<Math.max(a.x,b.x)+.56&&z>Math.min(a.z,b.z)-.56&&z<Math.max(a.z,b.z)+.56;
    });
  };
  // A cabinet can sit between grid cells: choose a clear approach cell,
  // then finish at the exact service position instead of rejecting the path.
  if(blocked(end)){
    const candidates:Position[]=[];
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
      const next:Position=[end[0]+dx,end[1]+dz];
      if(next[0]>=0&&next[0]<width&&next[1]>=0&&next[1]<height&&!blocked(next))candidates.push(next);
    }
    candidates.sort((a,b)=>Math.hypot(world(a)[0]-to[0],world(a)[1]-to[1])-Math.hypot(world(b)[0]-to[0],world(b)[1]-to[1]));
    if(!candidates.length)return [];
    end=candidates[0];
  }
  const queue:Position[]=[start], parents=new Map<number,Position|null>([[key(start),null]]);
  let found=false;
  for(let head=0;head<queue.length;head++){
    const current=queue[head];
    if(key(current)===key(end)){found=true;break;}
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const next:Position=[current[0]+dx,current[1]+dz];
      if(next[0]<0||next[0]>=width||next[1]<0||next[1]>=height||parents.has(key(next))||blocked(next))continue;
      parents.set(key(next),current);queue.push(next);
    }
  }
  if(!found)return [];
  const path:Position[]=[];
  let cursor:Position|null=end;
  while(cursor&&key(cursor)!==key(start)){path.push(world(cursor));cursor=parents.get(key(cursor))??null;}
  path.reverse();path.push(to);
  return path;
}
