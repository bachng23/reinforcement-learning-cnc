export type LayoutId = 'machining' | 'fabrication' | 'assembly' | 'packaging';
export type MachineKind = 'turning' | 'milling' | 'inspection' | 'laser' | 'press' | 'welding' | 'washer' | 'assembly' | 'filler' | 'labeler' | 'packer' | 'smt' | 'reflow' | 'aoi' | 'insertion' | 'solder' | 'ict' | 'dispense' | 'fastening' | 'hipot' | 'burnin' | 'ate' | 'packout';
export type LayoutStation = { x: number; z: number; kind: MachineKind; name: string; operation: string };
export type RouteNode = { x: number; z: number; station?: number };
export type FactoryLayout = {
  id: LayoutId; name: string; description: string; product: string;
  inputLabel: string; outputLabel: string; payload: 'smt-pcb' | 'power-pcb' | 'open-psu' | 'server-psu';
  stations: LayoutStation[]; route: RouteNode[]; home: [number, number];
};
export const factoryLayouts: FactoryLayout[] = [
  {id:'machining', name:'01 · SMT board assembly', description:'Paste printing & placement → reflow → optical inspection', product:'Server PSU · surface-mounted PCB',inputLabel:'Bare PCB & SMD reels',outputLabel:'SMT boards → power assembly',payload:'smt-pcb', home:[5.25,-2.52],
    stations:[
      {x:-5.6,z:-.65,kind:'smt',name:'SMT placement cell',operation:'SMD placement'},
      {x:-1.45,z:-.65,kind:'reflow',name:'Reflow soldering oven',operation:'Reflow soldering'},
      {x:2.7,z:-.65,kind:'aoi',name:'Automated optical inspection',operation:'Solder & placement inspection'},
    ],route:[{x:-9.58,z:.72},{x:-5.6,z:.72,station:0},{x:-1.45,z:.72,station:1},{x:2.7,z:.72,station:2},{x:8.18,z:.72},{x:8.18,z:4.7},{x:2.8,z:4.7}]},
  {id:'fabrication', name:'02 · Power board assembly', description:'Insert power components → selective soldering → in-circuit test', product:'Server PSU · tested power board',inputLabel:'SMT boards & power components',outputLabel:'Tested boards → PSU assembly',payload:'power-pcb',home:[-4,-6.3],
    stations:[
      {x:-5,z:-3,kind:'insertion',name:'Power component insertion cell',operation:'Transformer & capacitor insertion'},
      {x:0,z:-3,kind:'solder',name:'Selective soldering machine',operation:'Through-hole soldering'},
      {x:4,z:2.5,kind:'ict',name:'In-circuit test station',operation:'Board electrical test'},
    ],route:[{x:-9,z:-1.63},{x:-5,z:-1.63,station:0},{x:0,z:-1.63,station:1},{x:7,z:-1.63},{x:7,z:3.87},{x:4,z:3.87,station:2},{x:.5,z:3.87}]},
  {id:'assembly', name:'03 · PSU final assembly', description:'Thermal interface dispensing → fastening → electrical safety test', product:'Server PSU · assembled module',inputLabel:'Power boards, chassis & fans',outputLabel:'Assembled PSU → validation',payload:'open-psu',home:[-1,-6.3],
    stations:[
      {x:-4,z:-3,kind:'dispense',name:'Thermal interface dispensing cell',operation:'Thermal interface application'},
      {x:4,z:-3,kind:'fastening',name:'Robotic screwdriving cell',operation:'Board, fan & enclosure fastening'},
      {x:4,z:3,kind:'hipot',name:'Electrical safety test cell',operation:'Hi-pot & ground-bond test'},
    ],route:[{x:-9,z:-1.63},{x:-4,z:-1.63,station:0},{x:4,z:-1.63,station:1},{x:7,z:-1.63},{x:7,z:4.37},{x:4,z:4.37,station:2},{x:-6,z:4.37}]},
  {id:'packaging', name:'04 · Reliability & pack-out', description:'Burn-in → automated load test → traceability & ESD packing',product:'Server PSU · validated shipping unit',inputLabel:'Assembled server PSU',outputLabel:'ESD-packed PSU → dispatch',payload:'server-psu',home:[-1,-6.5],
    stations:[
      {x:-5,z:-4,kind:'burnin',name:'PSU burn-in rack',operation:'Powered reliability screening'},
      {x:0,z:0,kind:'ate',name:'Automated power test system',operation:'Load, regulation & efficiency test'},
      {x:5,z:4,kind:'packout',name:'Traceability & ESD packing cell',operation:'Serial verification & ESD pack-out'},
    ],route:[{x:-9,z:-2.63},{x:-5,z:-2.63,station:0},{x:-2.1,z:-2.63},{x:-2.1,z:1.37},{x:0,z:1.37,station:1},{x:2.9,z:1.37},{x:2.9,z:5.37},{x:5,z:5.37,station:2},{x:9,z:5.37}]},
];
export const getFactoryLayout = (id?: string) => factoryLayouts.find(layout=>layout.id===id) ?? factoryLayouts[0];
