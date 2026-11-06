import { describe, expect, it } from 'vitest';
import { factoryLayouts } from '@/lib/simulation/factory-layouts';
import { technicianRoute } from '@/lib/simulation/technician-route';

describe('factory workshop geometry and maintenance access',()=>{
  it('provides four distinct workflows with ordered connected orthogonal routes',()=>{
    expect(factoryLayouts).toHaveLength(4);
    expect(new Set(factoryLayouts.map(l=>JSON.stringify(l.stations.map(s=>s.kind)))).size).toBe(4);
    for(const layout of factoryLayouts){
      expect(layout.route.flatMap(n=>n.station===undefined?[]:[n.station])).toEqual([0,1,2]);
      for(let i=1;i<layout.route.length;i++){
        const a=layout.route[i-1],b=layout.route[i];
        expect(a.x===b.x||a.z===b.z).toBe(true);
        expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThan(.96);
      }
    }
  });
  for(const layout of factoryLayouts){
    it(`finds clear technician paths between all cabinets in ${layout.id}`,()=>{
      const cabinets=layout.stations.map((s,i)=>[s.x+(i===2?1.63:i===0?1.86:1.82),s.z+.13] as [number,number]);
      for(const from of [layout.home,...cabinets])for(const to of cabinets){
        if(from===to)continue;
        const path=technicianRoute(layout,from,to);
        expect(path.length).toBeGreaterThan(0);
        expect(path.at(-1)).toEqual(to);
        for(const [x,z] of path)expect(layout.stations.some(s=>Math.abs(x-s.x)<1.5&&Math.abs(z-s.z)<1)).toBe(false);
      }
    });
  }
});
