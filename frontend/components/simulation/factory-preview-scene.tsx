'use client';

import { Canvas, useFrame, useThree, type ThreeElements } from '@react-three/fiber';
import { createContext, useContext, useEffect, useRef, type RefObject } from 'react';
import { BoxGeometry, Color, EdgesGeometry, Vector3, type Group } from 'three';
import { technicianRoute } from '@/lib/simulation/technician-route';
import { getFactoryLayout, type FactoryLayout, type LayoutStation, type MachineKind } from '@/lib/simulation/factory-layouts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Point = [number, number, number];
export type PreviewStatus = 'Working' | 'Breakdown' | 'In service';

const colors: Record<PreviewStatus, string> = {
  Working: '#168665', Breakdown: '#d84248', 'In service': '#297cc2',
};
const machineX = (machine: number) => -5.6 + machine * 4.15;
const materialLine = { entry: -9.1, exit: 7.7, laneZ: 0.72, dockZ: 0.37, deckY: 0.71 };
const dockHalfWidth = 0.48;
const stationLabelHeight = [2.43, 2.78, 2.18];
const stationFrames = stationLabelHeight.map(height => {
  const geometry = new BoxGeometry(3.15, height + 0.16, 2.06);
  const edges = new EdgesGeometry(geometry);
  geometry.dispose();
  return edges;
});
const stationZ = -0.65;
const serviceAisleZ = -2.52;
const cabinetZ = 0.13;
const cabinetMounts = [
  { x: 1.31, y: 1.12, scale: 1 },
  { x: 1.27, y: 1.12, scale: 1 },
  { x: 1.23, y: 0.38, scale: 0.68 },
];
const cabinetHeight = 0.66;
const cabinetWidth = 0.62;
const cabinetDepth = 0.15;
const cabinetWall = 0.045;
const cabinetDoorThickness = 0.038;
const cameraHome: Point = [9, 15, 25];
const shopLabels: { title: string; at: Point }[] = [
  { title: '01 · Stock cutting', at: [-9.58, 2.05, materialLine.laneZ] },
  { title: '02 · Conveyor transfer', at: [8.18, 1.35, 2.7] },
  { title: '03 · Pack & palletize', at: [5.3, 1.95, 4.7] },
  { title: '04 · Dispatch', at: [2.6, 2.16, 6.05] },
];
const floorGridVertex = `
  varying vec2 floorPosition;
  varying float depthFromCell;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 view = viewMatrix * world;
    floorPosition = world.xz;
    depthFromCell = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z - view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const floorGridFragment = `
  varying vec2 floorPosition;
  varying float depthFromCell;
  uniform float emphasis;

  float gridLine(float spacing) {
    vec2 cell = floorPosition / spacing;
    vec2 pixel = max(fwidth(cell), vec2(0.0001));
    vec2 distanceToLine = abs(fract(cell - 0.5) - 0.5) / pixel;
    return 1.0 - smoothstep(0.1, 1.0, min(distanceToLine.x, distanceToLine.y));
  }

  void main() {
    float depthFade = 1.0 - smoothstep(1.0, 13.0, depthFromCell);
    float edgeFade = 1.0 - smoothstep(12.0, 26.0, length(floorPosition));
    float lines = max(gridLine(0.8) * 0.24, gridLine(4.0) * 0.37);
    gl_FragColor = vec4(0.38, 0.46, 0.52, lines * depthFade * edgeFade * emphasis);
  }
`;

function FactoryGround() {
  const muted = useContext(StationMuted);
  return <group rotation={[-Math.PI / 2, 0, 0]}>
    <mesh>
      <planeGeometry args={[64, 64]} />
      <shaderMaterial vertexShader={floorGridVertex} fragmentShader={floorGridFragment} uniforms={{ emphasis: { value: muted ? 0.28 : 1 } }} transparent depthWrite={false} />
    </mesh>
    <mesh receiveShadow renderOrder={1}>
      <planeGeometry args={[28, 18]} />
      <shadowMaterial opacity={muted ? 0.055 : 0.2} depthWrite={false} />
    </mesh>
  </group>;
}

export type ShopStation = { status: PreviewStatus };
export type ShopTechnician = { machine: number | null; justDispatched: boolean };

const StationMuted = createContext(false);
const mutedStationColor = new Color('#dce4ea');

function StationMaterial({ color, ...props }: Omit<ThreeElements['meshStandardMaterial'], 'color'> & { color: string }) {
  const muted = useContext(StationMuted);
  return <meshStandardMaterial {...props} color={muted ? new Color(color).lerp(mutedStationColor, 0.59) : color} />;
}

function Box({ at, size, color, metal = 0 }: { at: Point; size: Point; color: string; metal?: number }) {
  return <mesh position={at} castShadow receiveShadow>
    <boxGeometry args={size} />
    <StationMaterial color={color} roughness={0.46} metalness={metal} />
  </mesh>;
}

type MachineModelProps = { moving: boolean; failed: boolean };

function ServiceCabinet({ machine, servicing, arrivals, moving }: {
  machine: number; servicing: boolean; arrivals: RefObject<(number | null)[]>; moving: boolean;
}) {
  const hinge = useRef<Group>(null);
  const mount = cabinetMounts[machine];
  useFrame((_, delta) => {
    if (!hinge.current) return;
    const target = servicing && arrivals.current.includes(machine) ? Math.PI * 0.56 : 0;
    hinge.current.rotation.y = moving ? moveToward(hinge.current.rotation.y, target, delta * 7) : target;
  });

  return <group position={[mount.x, mount.y, cabinetZ]} scale={mount.scale}>
    <Box at={[0, 0, 0]} size={[0.038, cabinetHeight, cabinetWidth]} color="#425761" />
    {[-1, 1].map(side => <group key={side}>
      <Box at={[cabinetDepth / 2, side * (cabinetHeight - cabinetWall) / 2, 0]}
        size={[cabinetDepth, cabinetWall, cabinetWidth]} color="#425761" />
      <Box at={[cabinetDepth / 2, 0, side * (cabinetWidth - cabinetWall) / 2]}
        size={[cabinetDepth, cabinetHeight - 2 * cabinetWall, cabinetWall]} color="#425761" />
    </group>)}
    <Box at={[0.028, 0, 0]} size={[0.018, 0.55, 0.51]} color="#263c45" />
    <Box at={[0.054, 0.06, 0]} size={[0.021, 0.36, 0.41]} color="#3f7e69" />
    {[-0.135, 0, 0.135].map(z => <group key={z} position={[0.076, 0.08, z]}>
      <Box at={[0, 0.042, 0]} size={[0.034, 0.12, 0.075]} color="#29363e" />
      <Box at={[0, -0.076, 0]} size={[0.028, 0.055, 0.057]} color="#d2a253" />
    </group>)}
    <Box at={[0.074, -0.19, 0]} size={[0.04, 0.08, 0.44]} color="#b2c1c7" metal={0.35} />
    <group ref={hinge} position={[cabinetDepth + cabinetDoorThickness / 2, 0, -cabinetWidth / 2]}>
      <Box at={[0, 0, cabinetWidth / 2]} size={[cabinetDoorThickness, cabinetHeight, cabinetWidth]}
        color="#a7bbc4" metal={0.2} />
      <Box at={[0.03, 0.05, 0.52]} size={[0.023, 0.15, 0.034]} color="#394c56" />
      <Box at={[0.029, 0.15, 0.26]} size={[0.016, 0.075, 0.085]} color="#d7a94b" />
    </group>
  </group>;
}


function Station({ machine, status, moving, selected, muted, arrivals, onSelect, placement }: {
  placement?: LayoutStation;
  machine: number; status: PreviewStatus; moving: boolean; selected: boolean; muted: boolean;
  arrivals: RefObject<(number | null)[]>; onSelect: () => void;
}) {
  const Model = placement ? machineModels[placement.kind] : stationModels[machine];
  const lamp = colors[status];
  const lampTop = stationLabelHeight[machine] - 0.16;
  return <StationMuted.Provider value={muted}>
    <group position={[placement?.x ?? machineX(machine), 0, placement?.z ?? stationZ]} onClick={event => { event.stopPropagation(); onSelect(); }}>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.9, 2.1]} />
        <meshBasicMaterial color={selected ? '#7caddb' : muted ? '#e5e9ee' : '#b2c0c8'} />
      </mesh>
      {selected && <lineSegments geometry={stationFrames[machine]} position={[0.06, (stationLabelHeight[machine] + 0.16) / 2, 0]}>
        <lineBasicMaterial color="#538bd5" transparent opacity={0.8} depthWrite={false} />
      </lineSegments>}
      <Model failed={status === 'Breakdown'} moving={moving && status === 'Working'} />
      {placement && machine < 2 && <Box at={[1.22,.94,.13]} size={[.22,.59,.68]} color="#8199a5" />}
      <ServiceCabinet machine={machine} servicing={status === 'In service'} arrivals={arrivals} moving={moving} />
      {placement && <Box at={[.92,(.7+lampTop-.17)/2,-.1]} size={[.06,lampTop-.17-.7,.06]} color="#708895"/>}
      <Box at={[0.92, lampTop - 0.17, -0.1]} size={[0.1, 0.22, 0.1]} color="#4f6470" />
      <mesh position={[0.92, lampTop, -0.1]} castShadow>
        <cylinderGeometry args={[0.099, 0.099, 0.2, 18]} />
        <StationMaterial color={lamp} emissive={lamp} emissiveIntensity={muted ? 0.12 : 0.75} />
      </mesh>
    </group>
  </StationMuted.Provider>;
}

function MillingCenter({ moving, failed }: MachineModelProps) {
  const tool = useRef<Group>(null);
  useFrame((_, delta) => {
    if (moving && tool.current) tool.current.rotation.y += delta * 8;
  });

  return <>
    <Box at={[0, 0.16, 0]} size={[2.58, 0.32, 1.62]} color="#333e47" />
    <Box at={[0, 0.47, 0]} size={[2.54, 0.37, 1.58]} color="#b3bcc2" metal={0.25} />
    <Box at={[0, 2.16, 0]} size={[2.54, 0.4, 1.58]} color="#d9e1e4" metal={0.2} />
    <Box at={[-1.12, 1.32, 0]} size={[0.3, 1.35, 1.57]} color="#dae2e5" />
    <Box at={[0.94, 1.32, 0]} size={[0.66, 1.35, 1.57]} color="#c8d4d9" />
    <Box at={[0, 1.32, -0.74]} size={[1.95, 1.35, 0.12]} color="#4d606a" />
    <Box at={[-0.17, 0.8, 0.02]} size={[1.42, 0.17, 1.05]} color="#82959f" metal={0.5} />
    {[-0.45, -0.23, -0.01, 0.21, 0.43].map(z =>
      <Box key={z} at={[-0.17, 0.893, z]} size={[1.36, 0.016, 0.022]} color="#425862" />
    )}
    <Box at={[-0.17, 0.98, 0.06]} size={[0.47, 0.15, 0.4]} color="#496a76" metal={0.35} />
    <Box at={[-0.17, 1.071, 0.06]} size={[0.27, 0.07, 0.24]} color="#bec9ce" metal={0.45} />
    <group position={[-0.17, 1.72, 0.06]}>
      <Box at={[0, 0.15, 0]} size={[0.52, 0.29, 0.49]} color="#627783" metal={0.25} />
      <group ref={tool}>
        <mesh castShadow><cylinderGeometry args={[0.145, 0.12, 0.23, 18]} />
          <StationMaterial color="#c1cdd1" metalness={0.45} roughness={0.29} />
        </mesh>
        <Box at={[0, -0.18, 0]} size={[0.12, 0.16, 0.07]} color="#adbec6" metal={0.5} />
      </group>
    </group>
    <mesh position={[-0.17, 1.3, 0.797]}>
      <planeGeometry args={[1.62, 1.3]} />
      <StationMaterial color="#557b90" transparent opacity={0.19} depthWrite={false} />
    </mesh>
    <Box at={[-0.17, 0.67, 0.8]} size={[1.64, 0.055, 0.055]} color="#526875" />
    <Box at={[-0.17, 1.93, 0.8]} size={[1.64, 0.055, 0.055]} color="#526875" />
    <Box at={[0.54, 1.32, 0.86]} size={[0.064, 0.42, 0.12]} color="#344b58" />
    <Box at={[0.95, 1.51, 0.83]} size={[0.43, 0.66, 0.18]} color="#253945" />
    <Box at={[0.95, 1.65, 0.926]} size={[0.32, 0.24, 0.018]} color={failed ? '#d57066' : '#73a8b6'} />
    {[0.84, 0.95, 1.06].map(x =>
      <Box key={x} at={[x, 1.36, 0.931]} size={[0.048, 0.047, 0.025]} color="#aebcc3" />
    )}
    <Box at={[-0.28, 2.21, 0.8]} size={[1.13, 0.09, 0.034]} color="#447a7a" />
  </>;
}

function TurningCenter({ moving, failed }: MachineModelProps) {
  const chuck = useRef<Group>(null);
  useFrame((_, delta) => {
    if (moving && chuck.current) chuck.current.rotation.x += delta * 8;
  });

  return <>
    <Box at={[0, 0.33, 0]} size={[2.7, 0.65, 1.55]} color="#394857" />
    <Box at={[0, 0.73, 0]} size={[2.67, 0.2, 1.5]} color="#a9bac5" metal={0.28} />
    <Box at={[-0.98, 1.36, 0]} size={[0.72, 1.1, 1.46]} color="#869ead" metal={0.22} />
    <Box at={[1.04, 1.33, 0]} size={[0.55, 1.05, 1.46]} color="#c2ced4" />
    <Box at={[0.08, 1.38, -0.68]} size={[1.54, 1.14, 0.12]} color="#5f7582" />
    <Box at={[0, 1.99, 0]} size={[2.66, 0.22, 1.48]} color="#d1dde1" />
    <Box at={[0.11, 0.97, 0.14]} size={[1.58, 0.16, 0.84]} color="#a0afb6" metal={0.44} />
    <group ref={chuck} position={[-0.61, 1.39, 0.1]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.33, 0.33, 0.19, 24]} />
        <StationMaterial color="#53636c" metalness={0.68} roughness={0.3} />
      </mesh>
      {[0, 2 * Math.PI / 3, 4 * Math.PI / 3].map(angle => <group key={angle} rotation={[angle, 0, 0]}>
        <Box at={[0.12, 0.23, 0]} size={[0.12, 0.16, 0.1]} color="#a8b6bd" metal={0.55} />
      </group>)}
      <mesh position={[0.32, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.105, 0.105, 0.57, 18]} />
        <StationMaterial color="#bfcbd0" metalness={0.63} roughness={0.32} />
      </mesh>
    </group>
    <Box at={[0.57, 1.12, 0.19]} size={[0.33, 0.24, 0.4]} color="#4e626e" />
    <mesh position={[0.09, 1.4, 0.747]}>
      <planeGeometry args={[1.43, 0.97]} />
      <StationMaterial color="#5b8398" transparent opacity={0.18} depthWrite={false} />
    </mesh>
    <Box at={[0.08, 0.91, 0.76]} size={[1.47, 0.065, 0.07]} color="#405765" />
    <Box at={[0.08, 1.9, 0.76]} size={[1.47, 0.065, 0.07]} color="#405765" />
    <Box at={[1.06, 1.49, 0.75]} size={[0.43, 0.48, 0.14]} color="#263b49" />
    <Box at={[1.06, 1.57, 0.83]} size={[0.31, 0.2, 0.02]} color={failed ? '#d57066' : '#7daebe'} />
  </>;
}

function InspectionCell({ moving, failed }: MachineModelProps) {
  const probe = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    if (!moving || !probe.current) return;
    elapsed.current += delta;
    probe.current.position.x = Math.sin(elapsed.current * 1.9) * 0.42;
  });

  return <>
    <Box at={[0, 0.31, 0]} size={[2.46, 0.62, 1.48]} color="#677f86" />
    <Box at={[0, 0.71, 0]} size={[2.52, 0.22, 1.53]} color="#34464e" />
    <Box at={[0, 0.847, 0]} size={[2.23, 0.06, 1.35]} color="#8d9ca1" />
    <Box at={[-0.9, 1.35, -0.22]} size={[0.22, 1.03, 0.56]} color="#b2c8c9" />
    <Box at={[0.9, 1.35, -0.22]} size={[0.22, 1.03, 0.56]} color="#b2c8c9" />
    <Box at={[0, 1.89, -0.22]} size={[2.04, 0.26, 0.52]} color="#5f9191" />
    <Box at={[0, 1.88, 0.052]} size={[1.68, 0.08, 0.035]} color="#c2d4d5" metal={0.4} />
    <group ref={probe}>
      <Box at={[0, 1.73, 0.01]} size={[0.32, 0.31, 0.31]} color="#405963" />
      <Box at={[0, 1.42, 0.04]} size={[0.09, 0.37, 0.09]} color="#c2ced2" metal={0.4} />
      <mesh position={[0, 1.23, 0.04]}><sphereGeometry args={[0.05, 12, 8]} />
        <StationMaterial color="#bd5557" />
      </mesh>
    </group>
    <Box at={[-0.23, 0.95, 0.09]} size={[0.55, 0.15, 0.48]} color="#b7c9cd" metal={0.48} />
    <Box at={[0.99, 1.11, 0.61]} size={[0.42, 0.37, 0.13]} color="#304752" />
    <Box at={[0.99, 1.16, 0.68]} size={[0.32, 0.19, 0.02]} color={failed ? '#d57066' : '#7daebe'} />
  </>;
}

const stationModels = [TurningCenter, MillingCenter, InspectionCell];

function WorkshopMachine({ kind, moving, failed }: MachineModelProps & {kind: MachineKind}) {
  const actuator=useRef<Group>(null), elapsed=useRef(0);
  useFrame((_,dt)=>{if(!moving||!actuator.current)return;elapsed.current+=Math.min(dt,.06);actuator.current.position.y=Math.sin(elapsed.current*2.5)*.09;});
  const accent=kind==='laser'||kind==='press'?'#6c9298':kind==='filler'||kind==='labeler'||kind==='packer'?'#719a91':'#6e8b9d';
  return <>
    <Box at={[0,.25,0]} size={[2.46,.5,1.55]} color="#3b505c" />
    <Box at={[0,.59,0]} size={[2.62,.18,1.52]} color="#b7c8ce" metal={.3} />
    <Box at={[1.02,.94,.78]} size={[.4,.42,.12]} color="#294451" />
    <Box at={[1.02,1.01,.85]} size={[.29,.17,.025]} color={failed?'#d57066':'#83b4bf'} />
    {kind==='laser' && <>
      <Box at={[0,.77,0]} size={[2.28,.14,1.25]} color="#6f818a" metal={.5} />
      {[-.48,-.24,0,.24,.48].map(z=><Box key={z} at={[0,.85,z]} size={[2.15,.025,.025]} color="#3f5967" />)}
      {[-1.08,1.08].map(x=><Box key={x} at={[x,1.17,-.25]} size={[.15,.75,1.02]} color={accent} />)}
      <group ref={actuator}><Box at={[0,1.57,-.25]} size={[2.35,.22,.28]} color={accent} />
        <Box at={[.15,1.32,-.17]} size={[.26,.35,.26]} color="#365563" />
        <mesh position={[.15,1.07,-.17]}><coneGeometry args={[.065,.17,12]} /><StationMaterial color="#c7ac65" /></mesh>
      </group>
      <Box at={[-.2,.88,.06]} size={[1.2,.025,.7]} color="#b7c7d0" metal={.6} />
    </>}
    {kind==='press' && <>
      {[-1,1].map(x=><Box key={x} at={[x,1.4,-.15]} size={[.3,1.5,1.06]} color={accent} />)}
      <Box at={[0,2.13,-.15]} size={[2.32,.29,1.12]} color="#cedadd" />
      <mesh position={[0,1.86,-.15]}><cylinderGeometry args={[.18,.18,.4,16]} /><StationMaterial color="#9aafb9" metalness={.6} /></mesh>
      <group ref={actuator}><Box at={[0,1.57,-.15]} size={[1.65,.2,.77]} color="#49616e" />
        <Box at={[0,1.43,-.08]} size={[1.56,.08,.15]} color="#d4ae58" />
      </group>
      <Box at={[0,.93,-.08]} size={[1.65,.22,.8]} color="#627b88" />
      <Box at={[0,1.06,-.08]} size={[1.5,.05,.5]} color="#aebdc6" metal={.6} />
    </>}
    {(kind==='welding'||kind==='assembly') && <>
      <group position={[-.4,.67,-.2]} scale={.58}><HandlingRobot at={[0,0,0]} moving={moving} /></group>
      <Box at={[.45,.92,.18]} size={[.7,.48,.65]} color="#7e969f" />
      <Box at={[.45,1.19,.18]} size={[.58,.07,.53]} color="#c3cfd1" metal={.5} />
      {[-1.12,1.12].map(x=><Box key={x} at={[x,1.25,-.65]} size={[.065,1.2,.065]} color="#ceaa53" />)}
      <Box at={[0,1.85,-.65]} size={[2.3,.065,.065]} color="#ceaa53" />
      <Box at={[0,1.25,-.69]} size={[2.24,1.14,.035]} color="#91a7b2" />
      {kind==='welding'&&<Box at={[-1.15,1.2,.05]} size={[.08,1.05,1.33]} color="#688a83" />}
    </>}
    {kind==='washer' && <>
      <Box at={[0,1.25,-.15]} size={[2.35,1.15,1.18]} color="#a5babc" metal={.45} />
      <Box at={[0,1.27,.46]} size={[1.6,.66,.04]} color="#365d6b" />
      {[-.55,0,.55].map(x=><Box key={x} at={[x,1.27,.49]} size={[.035,.62,.025]} color="#8aadb2" />)}
      <mesh position={[0,1.97,-.2]}><cylinderGeometry args={[.25,.25,.3,16]} /><StationMaterial color="#7b9b9e" metalness={.4}/></mesh>
      <Box at={[0,2.14,-.2]} size={[.63,.08,.63]} color="#b9cdd0" />
    </>}
    {kind==='filler' && <>
      {[-1,1].map(x=><Box key={x} at={[x,1.35,-.4]} size={[.12,1.4,.12]} color="#a2b7bc" metal={.55} />)}
      <Box at={[0,2.03,-.4]} size={[2.18,.18,.37]} color={accent} />
      <group ref={actuator}>{[-.65,0,.65].map(x=><group key={x}>
        <mesh position={[x,1.57,-.04]}><cylinderGeometry args={[.055,.055,.7,12]}/><StationMaterial color="#acbdc4" metalness={.6}/></mesh>
        <mesh position={[x,1.07,-.04]}><cylinderGeometry args={[.12,.12,.36,14]}/><StationMaterial color="#75b1ad" transparent opacity={.8}/></mesh>
      </group>)}</group>
      <mesh position={[-.5,1.7,-.47]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.33,.33,.47,18]}/><StationMaterial color="#c0ced0" metalness={.55}/></mesh>
    </>}
    {kind==='labeler' && <>
      {[-.77,.77].map(x=><group key={x}>
        <Box at={[x,1.05,-.3]} size={[.12,.73,.12]} color="#5c7d89" />
        <mesh position={[x,1.52,-.3]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.36,.36,.2,20]}/><StationMaterial color={x<0?'#dad6c6':'#8ca8b1'} /></mesh>
      </group>)}
      <Box at={[0,1.4,-.14]} size={[1.5,.11,.08]} color="#b5c9cf" />
      <Box at={[0,1.1,.12]} size={[.37,.5,.34]} color="#6eaaa3" />
      <Box at={[0,1.14,.3]} size={[.38,.16,.02]} color="#e3e4d9" />
    </>}
    {kind==='packer' && <>
      {[-1,1].map(x=><Box key={x} at={[x,1.25,-.3]} size={[.17,1.16,.7]} color={accent} />)}
      <Box at={[0,1.89,-.3]} size={[2.23,.22,.73]} color="#c3d2d4" />
      <group ref={actuator}><Box at={[0,1.52,-.17]} size={[.65,.45,.6]} color="#607e87" />
        <Box at={[0,1.26,.08]} size={[.5,.09,.5]} color="#c7a25c" /></group>
      <Box at={[0,.97,.08]} size={[.8,.55,.62]} color="#c1a377" />
      <Box at={[0,1.25,.08]} size={[.07,.015,.63]} color="#d7c3a0" />
    </>}
  </>;
}
function CircuitBoard({ power=false }: {power?:boolean}) {
  return <group>
    <Box at={[0,.025,0]} size={[1.3,.05,.65]} color="#36766a" />
    {[-.48,-.16,.16,.48].map(x=><group key={x}>
      <Box at={[x,.07,-.17]} size={[.13,.05,.16]} color="#253a43" />
      <Box at={[x,.055,.16]} size={[.19,.015,.05]} color="#c0ae70" />
    </group>)}
    {power && <>
      <Box at={[-.2,.2,.03]} size={[.32,.28,.29]} color="#c7a95f"/>
      <Box at={[-.2,.2,.03]} size={[.08,.3,.31]} color="#4c5961"/>
      {[.18,.43].map(x=><mesh key={x} position={[x,.16,.02]} castShadow><cylinderGeometry args={[.095,.095,.23,12]}/><StationMaterial color="#364a55" metalness={.3}/></mesh>)}
      {[-.48,-.39].map(x=><Box key={x} at={[x,.14,.01]} size={[.035,.2,.32]} color="#aebfc6" metal={.65}/>)}
    </>}
  </group>;
}

function PowerModule({ open=false }: {open?:boolean}) {
  return <group>
    <Box at={[0,.025,0]} size={[1.25,.05,.48]} color="#9caeb8" metal={.55}/>
    {[-.23,.23].map(z=><Box key={z} at={[0,.17,z]} size={[1.25,.29,.025]} color="#afc0c7" metal={.5}/>)}
    {open?<group position={[0,.06,0]} scale={[.8,.7,.6]}><CircuitBoard power/></group>:<>
      <Box at={[0,.31,0]} size={[1.25,.025,.48]} color="#bac9ce" metal={.5}/>
      {[-.42,-.28,-.14,0,.14,.28,.42].map(x=><Box key={x} at={[x,.328,0]} size={[.025,.008,.32]} color="#526a77"/>)}
    </>}
    <mesh position={[.635,.17,0]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.13,.13,.025,18]}/><StationMaterial color="#30434e"/></mesh>
    <mesh position={[.651,.17,0]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.045,.045,.03,12]}/><StationMaterial color="#7d939f"/></mesh>
    <Box at={[-.65,.12,0]} size={[.05,.12,.32]} color="#3a515d"/>
    <Box at={[-.68,.12,0]} size={[.02,.07,.24]} color="#c2a65a" metal={.4}/>
  </group>;
}

function ElectronicsMachine({kind,moving,failed}:MachineModelProps & {kind:MachineKind}) {
  const head=useRef<Group>(null),time=useRef(0);
  useFrame((_,dt)=>{
    if(!moving||!head.current)return;
    time.current+=Math.min(dt,.06);
    if(['smt','aoi','insertion','dispense'].includes(kind))head.current.position.x=Math.sin(time.current*2)*.42;
    else head.current.position.y=Math.sin(time.current*2.5)*.075;
  });
  const enclosed=['smt','aoi','solder','hipot'].includes(kind);
  return <>
    <Box at={[0,.26,0]} size={[2.46,.52,1.48]} color="#455d6a"/>
    <Box at={[0,.64,0]} size={[2.5,.24,1.5]} color="#bacbd0" metal={.25}/>
    <Box at={[1.02,1.01,.77]} size={[.38,.45,.12]} color="#2f4856"/>
    <Box at={[1.02,1.08,.84]} size={[.27,.2,.02]} color={failed?'#cc7c76':'#83b6c0'}/>
    {enclosed && <>
      {[-1.1,1.1].map(x=><Box key={x} at={[x,1.35,-.06]} size={[.22,1.2,1.35]} color="#d3dfe2"/>)}
      <Box at={[0,1.99,-.06]} size={[2.42,.18,1.35]} color="#dbe4e6"/>
      <Box at={[0,1.35,-.7]} size={[2.2,1.2,.07]} color="#6b8996"/>
      <mesh position={[0,1.4,.645]}><planeGeometry args={[1.95,.95]}/><StationMaterial color="#739aa9" transparent opacity={.18} depthWrite={false}/></mesh>
      <Box at={[0,.93,.66]} size={[2.05,.045,.045]} color="#5b7a89"/>
      <Box at={[.76,1.4,.69]} size={[.045,.28,.08]} color="#456375"/>
    </>}
    {(kind==='smt'||kind==='aoi'||kind==='insertion')&&<>
      <group position={[0,.79,.04]} scale={.95}><CircuitBoard power={kind==='insertion'}/></group>
      <Box at={[0,1.69,-.23]} size={[1.8,.13,.15]} color="#7797a5" metal={.35}/>
      <group ref={head}><Box at={[0,1.49,-.06]} size={[kind==='aoi'?.38:.48,.3,.32]} color="#446576"/>
        {(kind==='smt'?[-.16,0,.16]:[0]).map(x=><mesh key={x} position={[x,1.25,-.02]}><cylinderGeometry args={[.025,.025,.23,10]}/><StationMaterial color="#b4c8d0" metalness={.6}/></mesh>)}
        {kind==='aoi'&&<Box at={[0,1.29,.02]} size={[.36,.035,.29]} color="#b5d6d8"/>}
      </group>
      {kind==='smt'&&[-.7,-.42,-.14,.14,.42,.7].map(x=><group key={x}>
        <Box at={[x,.8,.62]} size={[.08,.08,.53]} color="#455f6d"/>
        <mesh position={[x,.69,.92]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.19,.19,.06,14]}/><StationMaterial color="#819aa7"/></mesh>
      </group>)}
      {kind==='insertion'&&<>
        {[-1,1].map(x=><Box key={x} at={[x,1.28,-.5]} size={[.14,1.06,.16]} color="#9cb2be"/>)}
        <Box at={[-.7,.97,-.42]} size={[.5,.35,.35]} color="#ae9a67"/>
        <Box at={[.7,.97,-.42]} size={[.5,.35,.35]} color="#5b7889"/>
      </>}
    </>}
    {kind==='reflow'&&<>
      <Box at={[0,1.25,-.1]} size={[2.42,.96,1.25]} color="#cedbde" metal={.25}/>
      <Box at={[0,1.03,.54]} size={[1.82,.27,.045]} color="#3d5662"/>
      <Box at={[0,1.47,.54]} size={[1.84,.08,.04]} color="#689790"/>
      {[-.76,-.25,.25,.76].map(x=><group key={x}>
        <mesh position={[x,1.78,-.15]}><cylinderGeometry args={[.18,.18,.12,14]}/><StationMaterial color="#829ca7" metalness={.4}/></mesh>
        <Box at={[x,1.85,-.15]} size={[.23,.025,.025]} color="#415d6c"/>
      </group>)}
      <group position={[0,.81,.3]} scale={.8}><CircuitBoard/></group>
      <Box at={[-.9,1.16,.57]} size={[.1,.11,.02]} color="#d1ab59"/>
    </>}
    {kind==='solder'&&<>
      <Box at={[0,2.13,-.38]} size={[.7,.16,.5]} color="#91aab4"/>
      <mesh position={[0,2.28,-.38]}><cylinderGeometry args={[.16,.16,.3,14]}/><StationMaterial color="#9db2bb"/></mesh>
      <Box at={[0,.94,-.02]} size={[1.6,.3,.85]} color="#536f7d"/>
      <group position={[0,1.13,-.02]} scale={.9}><CircuitBoard power/></group>
      <group ref={head}><mesh position={[.25,1.02,.25]}><cylinderGeometry args={[.08,.12,.3,14]}/><StationMaterial color="#b2b4a0" metalness={.5}/></mesh></group>
    </>}
    {kind==='ict'&&<>
      {[-.95,.95].map(x=><Box key={x} at={[x,1.23,-.35]} size={[.16,.96,.36]} color="#95b0bb"/>)}
      <Box at={[0,1.77,-.35]} size={[2.06,.18,.58]} color="#bacdd1"/>
      <Box at={[0,.9,.04]} size={[1.56,.22,.91]} color="#657f8d"/>
      {[-.48,-.16,.16,.48].flatMap(x=>[-.22,0,.22].map(z=><Box key={`${x}:${z}`} at={[x,1.07,z]} size={[.02,.12,.02]} color="#c4aa62"/>))}
      <group position={[0,1.11,.04]} scale={.82}><CircuitBoard power/></group>
      <group ref={head}><Box at={[0,1.55,.04]} size={[1.5,.12,.85]} color="#9eb5c0"/><Box at={[0,1.39,.04]} size={[.8,.2,.5]} color="#688d8a"/></group>
    </>}
    {(kind==='dispense'||kind==='fastening')&&<>
      {[-1,1].map(x=><Box key={x} at={[x,1.28,-.45]} size={[.16,1.05,.19]} color="#90a9b8"/>)}
      <Box at={[0,1.85,-.45]} size={[2.15,.18,.27]} color="#c4d4d9"/>
      <group position={[0,.8,.09]} scale={1.1}><PowerModule open/></group>
      <group ref={head}>
        <Box at={[0,1.6,-.08]} size={[.45,.35,.36]} color="#4d7487"/>
        <mesh position={[0,1.27,.02]}><cylinderGeometry args={[.06,.04,.35,12]}/><StationMaterial color="#a9c0ca" metalness={.55}/></mesh>
        <Box at={[0,1.05,.02]} size={[.023,.13,.023]} color={kind==='dispense'?'#b8d5d0':'#596d7b'}/>
        {kind==='dispense'&&<mesh position={[.24,1.66,-.1]}><cylinderGeometry args={[.09,.09,.48,14]}/><StationMaterial color="#cbd8d8"/></mesh>}
      </group>
      {kind==='fastening'&&<>
        <Box at={[-.75,.94,.36]} size={[.38,.29,.35]} color="#7c969a"/>
        <Box at={[-.75,1.1,.36]} size={[.3,.03,.27]} color="#b9c8cc"/>
        <Box at={[0,1.25,-.65]} size={[1.75,.98,.04]} color="#8faab5"/>
      </>}
    </>}
    {kind==='hipot'&&<>
      <group position={[0,.8,0]} scale={1.1}><PowerModule/></group>
      {[-.8,.8].map(x=><Box key={x} at={[x,.95,0]} size={[.1,.25,.5]} color="#d1b365"/>)}
      <Box at={[0,1.69,-.64]} size={[.9,.3,.06]} color="#344f60"/>
      <Box at={[0,1.7,-.6]} size={[.7,.16,.02]} color="#8abcbf"/>
      <Box at={[-.82,1.79,.68]} size={[.18,.12,.02]} color="#d1b365"/>
    </>}
    {kind==='burnin'&&<>
      {[-1.05,1.05].map(x=><Box key={x} at={[x,1.34,-.15]} size={[.13,1.16,1.08]} color="#65828e"/>)}
      <Box at={[0,1.95,-.15]} size={[2.23,.12,1.08]} color="#a3bbc2"/>
      <Box at={[0,1.34,-.66]} size={[2.07,1.16,.07]} color="#425f6d"/>
      {[.82,1.18,1.54].map(y=><group key={y}>
        <Box at={[0,y,-.1]} size={[2.05,.05,1.01]} color="#819aa6" metal={.4}/>
        {[-.55,.48].map(x=><group key={x} position={[x,y+.035,-.1]} scale={[.7,.7,1.45]}><PowerModule/></group>)}
        <Box at={[.95,y+.16,.42]} size={[.025,.05,.025]} color={failed?'#b37d76':'#7eac98'}/>
      </group>)}
    </>}
    {kind==='ate'&&<>
      {[-.57,.57].map(x=><group key={x}>
        <Box at={[x,1.3,-.19]} size={[.96,1.08,1.03]} color="#758e9d"/>
        {[.96,1.21,1.46,1.71].map(y=><group key={y}>
          <Box at={[x,y,.35]} size={[.83,.19,.035]} color="#c0ced2"/>
          <Box at={[x-.2,y,.38]} size={[.27,.1,.018]} color="#4d7e8e"/>
          {[.12,.23,.34].map(offset=><Box key={offset} at={[x+offset,y,.38]} size={[.026,.11,.02]} color="#647f8b"/>)}
        </group>)}
      </group>)}
      <group position={[0,.84,.63]} scale={.72}><PowerModule/></group>
    </>}
    {kind==='packout'&&<>
      {[-1,1].map(x=><Box key={x} at={[x,1.22,-.3]} size={[.15,.92,.2]} color="#789b9b"/>)}
      <Box at={[0,1.75,-.3]} size={[2.12,.15,.35]} color="#bdcfd2"/>
      <group ref={head}><Box at={[0,1.49,-.08]} size={[.48,.39,.4]} color="#4e7486"/><Box at={[0,1.25,.1]} size={[.38,.08,.19]} color="#a9c6ce"/></group>
      <Box at={[0,.8,.08]} size={[1.62,.08,.85]} color="#7c929c"/>
      <group position={[0,.85,.08]} scale={.95}><PowerModule/></group>
      <Box at={[-.91,.99,.48]} size={[.27,.33,.3]} color="#d1d8d4"/>
      <Box at={[-.91,1.15,.55]} size={[.2,.02,.23]} color="#e5e8df"/>
    </>}
  </>;
}

const machineModels: Record<MachineKind, (props: MachineModelProps)=>React.JSX.Element> = {
  smt:props=><ElectronicsMachine {...props} kind="smt"/>,reflow:props=><ElectronicsMachine {...props} kind="reflow"/>,
  aoi:props=><ElectronicsMachine {...props} kind="aoi"/>,insertion:props=><ElectronicsMachine {...props} kind="insertion"/>,
  solder:props=><ElectronicsMachine {...props} kind="solder"/>,ict:props=><ElectronicsMachine {...props} kind="ict"/>,
  dispense:props=><ElectronicsMachine {...props} kind="dispense"/>,fastening:props=><ElectronicsMachine {...props} kind="fastening"/>,
  hipot:props=><ElectronicsMachine {...props} kind="hipot"/>,burnin:props=><ElectronicsMachine {...props} kind="burnin"/>,
  ate:props=><ElectronicsMachine {...props} kind="ate"/>,packout:props=><ElectronicsMachine {...props} kind="packout"/>,
  turning:TurningCenter,milling:MillingCenter,inspection:InspectionCell,
  laser:props=><WorkshopMachine {...props} kind="laser"/>,press:props=><WorkshopMachine {...props} kind="press"/>,
  welding:props=><WorkshopMachine {...props} kind="welding"/>,washer:props=><WorkshopMachine {...props} kind="washer"/>,
  assembly:props=><WorkshopMachine {...props} kind="assembly"/>,filler:props=><WorkshopMachine {...props} kind="filler"/>,
  labeler:props=><WorkshopMachine {...props} kind="labeler"/>,packer:props=><WorkshopMachine {...props} kind="packer"/>,
};

function WorkshopPallet({layout,stations,moving}:{layout:FactoryLayout;stations:ShopStation[];moving:boolean}) {
  const object=useRef<Group>(null), progress=useRef({node:1,wait:0,serviced:-1});
  useFrame((_,dt)=>{
    if(!moving||!object.current)return;
    const state=progress.current, target=layout.route[state.node],position=object.current.position;
    if(state.wait>0){if(target.station!==undefined&&stations[target.station].status!=='Working')return;state.wait-=Math.min(dt,.06);return;}
    if(target.station!==undefined&&stations[target.station].status!=='Working'&&Math.hypot(target.x-position.x,target.z-position.z)<.85)return;
    const dx=target.x-position.x,dz=target.z-position.z,distance=Math.hypot(dx,dz),step=Math.min(distance,Math.min(dt,.06)*1.8);
    if(distance>.005){position.x+=dx/distance*step;position.z+=dz/distance*step;object.current.rotation.y=Math.atan2(dx,dz);return;}
    if(target.station!==undefined&&state.serviced!==state.node){state.serviced=state.node;state.wait=1.5;return;}
    state.node++;
    if(state.node>=layout.route.length){position.set(layout.route[0].x,materialLine.deckY,layout.route[0].z);progress.current={node:1,wait:0,serviced:-1};}
  });
  return <group ref={object} position={[layout.route[0].x,materialLine.deckY,layout.route[0].z]}>
    <Box at={[0,.045,0]} size={[.48,.09,.45]} color="#4a6979" />
    <group position={[0,.1,0]} scale={layout.payload==='smt-pcb'||layout.payload==='power-pcb'?.42:.46}>
      {layout.payload==='smt-pcb'||layout.payload==='power-pcb'?<CircuitBoard power={layout.payload==='power-pcb'}/>:<PowerModule open={layout.payload==='open-psu'}/>}
    </group>
  </group>;
}

function StencilPrinter({at}:{at:Point}) {
  return <group position={at}>
    <Box at={[0,.4,0]} size={[1.35,.8,1.08]} color="#9bb2bd"/>
    <Box at={[0,.92,0]} size={[1.42,.18,1.13]} color="#d0dfe2"/>
    <Box at={[0,1.22,-.24]} size={[1.28,.47,.6]} color="#d2e0e3"/>
    <Box at={[0,1.14,.08]} size={[.98,.21,.055]} color="#527888"/>
    <Box at={[0,.99,.33]} size={[.92,.035,.37]} color="#718f9b"/>
    <group position={[0,1.01,.33]} scale={.55}><CircuitBoard/></group>
  </group>;
}

function WorkshopLine({layout,stations,moving}:{layout:FactoryLayout;stations:ShopStation[];moving:boolean}) {
  return <group>
    {layout.payload==='smt-pcb'&&<StencilPrinter at={[layout.route[0].x,0,layout.route[0].z-1.05]}/>}
    {layout.route.slice(1).map((b,i)=>{
      const a=layout.route[i],length=Math.hypot(b.x-a.x,b.z-a.z)-.96;
      return <BeltConveyor key={i} at={[(a.x+b.x)/2,0,(a.z+b.z)/2]} length={length} turn={a.x===b.x?Math.PI/2:0}/>;
    })}
    {layout.route.map((node,i)=><ConveyorCorner key={i} at={[node.x,0,node.z]}/>)}
    {layout.stations.map((station,i)=><group key={i} position={[station.x,0,station.z+1.02]}>
      <Box at={[0,.65,0]} size={[.6,.12,.7]} color="#768f9c" />
      <Box at={[0,.72,0]} size={[.5,.025,.66]} color="#a6bbc3" metal={.5}/>
    </group>)}
    <StorageRack at={[-9,0,-5.5]} electronics payload={layout.payload}/>
    <StorageRack at={[layout.route.at(-1)!.x,0,layout.route.at(-1)!.z+1.4]} electronics payload={layout.payload} cartons={layout.payload==='server-psu'}/>
    <Box at={[0,.015,-7.4]} size={[20,.025,.07]} color="#c99a3c"/>
    <Box at={[0,.015,-6.8]} size={[20,.025,.07]} color="#c99a3c"/>
    <WorkshopPallet layout={layout} stations={stations} moving={moving}/>
  </group>;
}

function RollerConveyor({ start, end }: { start: number; end: number }) {
  const length = end - start;
  const rollerCount = Math.ceil(length / 0.24);
  return <group position={[(start + end) / 2, 0, materialLine.laneZ]}>
    {[-0.36, 0.36].map(z =>
      <Box key={z} at={[0, 0.59, z]} size={[length, 0.14, 0.08]} color="#526d7b" metal={0.3} />
    )}
    {Array.from({ length: rollerCount }, (_, index) => (
      <mesh key={index} position={[(index + 0.5) * length / rollerCount - length / 2, 0.635, 0]}
        rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <cylinderGeometry args={[0.075, 0.075, 0.64, 10]} />
        <StationMaterial color={index % 4 === 0 ? '#708994' : '#a6b8be'} metalness={0.45} roughness={0.38} />
      </mesh>
    ))}
    {[-length * 0.32, length * 0.32].map(x => (
      <group key={x} position={[x, 0, 0]}>
        {[-0.29, 0.29].map(z => <Box key={z} at={[0, 0.28, z]} size={[0.09, 0.56, 0.09]} color="#435863" />)}
        <Box at={[0, 0.17, 0]} size={[0.08, 0.08, 0.62]} color="#647b86" />
      </group>
    ))}
  </group>;
}

function BeltConveyor({ at, length, turn = 0 }: { at: Point; length: number; turn?: number }) {
  return <group position={at} rotation={[0, turn, 0]}>
    <Box at={[0, 0.64, 0]} size={[length, 0.14, 0.74]} color="#354e5a" />
    {Array.from({ length: Math.ceil(length / 0.28) }, (_, index) =>
      <Box key={index} at={[(index + 0.5) * length / Math.ceil(length / 0.28) - length / 2, 0.718, 0]}
        size={[0.02, 0.012, 0.61]} color="#6d8790" />
    )}
    {[-0.42, 0.42].map(z =>
      <Box key={z} at={[0, 0.71, z]} size={[length, 0.19, 0.065]} color="#a2b6c0" metal={0.35} />
    )}
    {[-length * 0.37, length * 0.37].map(x => <group key={x}>
      {[-0.3, 0.3].map(z =>
        <Box key={z} at={[x, 0.3, z]} size={[0.095, 0.6, 0.095]} color="#526b76" />
      )}
    </group>)}
  </group>;
}

/** Flush, unobstructed right-angle transfer decks between conveyor runs. */
function ConveyorCorner({ at }: { at: Point }) {
  return <group position={at}>
    <Box at={[0, 0.64, 0]} size={[0.96, 0.14, 0.96]} color="#354e5a" />
    <Box at={[0, 0.718, 0]} size={[0.94, 0.014, 0.94]} color="#6d8790" />
    {[-0.23, 0, 0.23].flatMap(x => [-0.23, 0, 0.23].map(z => <mesh key={`${x}-${z}`} position={[x, 0.73, z]} castShadow>
      <sphereGeometry args={[0.055, 8, 6]} /><StationMaterial color="#b2c2c8" metalness={0.45} />
    </mesh>))}
    {[-0.34, 0.34].flatMap(x => [-0.34, 0.34].map(z =>
      <Box key={`${x}-${z}`} at={[x, 0.3, z]} size={[0.095, 0.6, 0.095]} color="#526b76" />
    ))}
  </group>;
}

function StockCutter({ moving }: { moving: boolean }) {
  const saw = useRef<Group>(null);
  const time = useRef(0);
  useFrame((_, delta) => {
    if (!moving || !saw.current) return;
    time.current += delta;
    saw.current.position.y = 1.32 + Math.sin(time.current * 1.9) * 0.12;
  });
  return <group position={[materialLine.entry - 0.48, 0, materialLine.laneZ]}>
    <Box at={[-0.67, 0.4, 0]} size={[0.35, 0.8, 1.16]} color="#536f7d" />
    <Box at={[0.67, 0.4, 0]} size={[0.35, 0.8, 1.16]} color="#536f7d" />
    <Box at={[0, 0.65, 0]} size={[1.7, 0.12, 1.18]} color="#9caeb5" metal={0.3} />
    <Box at={[0, 0.92, -0.35]} size={[1.5, 0.14, 0.23]} color="#849ba7" />
    <group ref={saw} position={[0, 1.32, 0]}>
      <Box at={[0, 0.27, 0]} size={[1.6, 0.28, 0.38]} color="#698d96" />
      {[-0.65, 0.65].map(x =>
        <Box key={x} at={[x, 0, 0]} size={[0.24, 0.52, 0.38]} color="#698d96" />
      )}
      <Box at={[0, -0.24, 0]} size={[1.16, 0.035, 0.07]} color="#b9c6ce" metal={0.7} />
      <Box at={[0, 0.265, 0.2]} size={[0.72, 0.075, 0.025]} color="#c7a04a" />
    </group>
    <Box at={[-0.67, 0.98, 0.64]} size={[0.28, 0.3, 0.12]} color="#294451" />
    <Box at={[-0.67, 1.03, 0.71]} size={[0.2, 0.12, 0.025]} color="#84b2bb" />
  </group>;
}

function HandlingRobot({ at, rotation = 0, moving }: { at: Point; rotation?: number; moving: boolean }) {
  const shoulder = useRef<Group>(null);
  const elbow = useRef<Group>(null);
  const time = useRef(0);
  useFrame((_, delta) => {
    if (!moving) return;
    time.current += Math.min(delta, 0.06);
    if (shoulder.current) shoulder.current.rotation.z = 0.35 + Math.sin(time.current * 1.2) * 0.12;
    if (elbow.current) elbow.current.rotation.z = -1.45 + Math.cos(time.current * 1.2) * 0.18;
  });
  return <group position={at} rotation={[0, rotation, 0]}>
    <Box at={[0, 0.12, 0]} size={[1.06, 0.24, 0.98]} color="#526a78" />
    <mesh position={[0, 0.32, 0]} castShadow>
      <cylinderGeometry args={[0.3, 0.34, 0.2, 18]} /><StationMaterial color="#3c5360" metalness={0.3} />
    </mesh>
    <mesh position={[0, 0.525, 0]} castShadow>
      <cylinderGeometry args={[0.27, 0.3, 0.29, 18]} /><StationMaterial color="#526a78" metalness={0.35} />
    </mesh>
    <group position={[0, 0.12, 0]} scale={[1.3, 1.3, 1.3]}>
    <group ref={shoulder} position={[0, 0.42, 0]} rotation={[0, 0, 0.35]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.36, 18]} /><StationMaterial color="#3c5360" />
      </mesh>
      <Box at={[0, 0.49, 0]} size={[0.3, 0.97, 0.32]} color="#ce9b51" />
      <mesh position={[0, 0.98, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.205, 0.205, 0.39, 18]} /><StationMaterial color="#3c5360" />
      </mesh>
      <group ref={elbow} position={[0, 0.98, 0]} rotation={[0, 0, -1.45]}>
        <Box at={[0, 0.45, 0]} size={[0.23, 0.85, 0.25]} color="#ce9b51" />
        <Box at={[0, 0.9, 0]} size={[0.24, 0.18, 0.27]} color="#3b5460" />
        {[-0.1, 0.1].map(z =>
          <Box key={z} at={[0.08, 1.02, z]} size={[0.26, 0.07, 0.06]} color="#8298a3" metal={0.45} />
        )}
      </group>
    </group>
    </group>
  </group>;
}

function PackingStation() {
  return <group position={[5.3, 0, 4.7]}>
    {[-0.68, 0.68].map(x =>
      <Box key={x} at={[x, 0.87, -0.53]} size={[0.14, 1.74, 0.14]} color="#75919c" />
    )}
    <Box at={[0, 1.72, -0.53]} size={[1.5, 0.15, 0.22]} color="#75919c" />
    <Box at={[0, 1.54, -0.32]} size={[0.4, 0.3, 0.49]} color="#415f70" />
    <Box at={[0, 1.38, -0.04]} size={[0.28, 0.09, 0.37]} color="#bf944d" />
    <Box at={[-0.64, 0.98, 0.61]} size={[0.35, 0.43, 0.17]} color="#304c5d" />
    <Box at={[-0.64, 1.06, 0.7]} size={[0.26, 0.15, 0.02]} color="#83b0bb" />
  </group>;
}

function StorageRack({ at, cartons = false, electronics=false, payload='smt-pcb' }: { at: Point; cartons?: boolean; electronics?:boolean; payload?:FactoryLayout['payload'] }) {
  return <group position={at}>
    {[-0.88, 0.88].flatMap(x => [-0.38, 0.38].map(z =>
      <Box key={`${x}-${z}`} at={[x, 0.95, z]} size={[0.09, 1.9, 0.09]} color="#647e8d" />
    ))}
    {[0.18, 0.92, 1.66].map(y => <group key={y}>
      <Box at={[0, y, 0]} size={[1.9, 0.07, 0.88]} color="#8298a2" />
      {[-0.52, 0, 0.52].map(x =>
        <group key={x}>
          {electronics&&!cartons?<group position={[x,y+.1,0]} scale={.36}>{payload==='open-psu'||payload==='server-psu'?<PowerModule open={payload==='open-psu'}/>:<CircuitBoard power={payload==='power-pcb'}/>}</group>:<Box at={[x,y+.19,0]} size={[.4,cartons?.33:.18,.58]} color={cartons?'#c2a275':'#9cabb2'} metal={cartons?0:.3}/>}
        </group>
      )}
    </group>)}
  </group>;
}

function SafetyFence() {
  return <group position={[9.95, 0, 2.7]}>
    {[-1.58, 0, 1.58].map(z =>
      <Box key={z} at={[0, 0.76, z]} size={[0.065, 1.52, 0.065]} color="#d0ab52" />
    )}
    {[-0.79, 0.79].map(z => <group key={z} position={[0, 0, z]}>
      {[0.16, 1.42].map(y =>
        <Box key={y} at={[0, y, 0]} size={[0.045, 0.045, 1.56]} color="#657b84" />
      )}
      {[-0.57, -0.28, 0, 0.28, 0.57].map(offset =>
        <Box key={offset} at={[0, 0.8, offset]} size={[0.018, 1.24, 0.018]} color="#9eabb0" />
      )}
    </group>)}
  </group>;
}

function TransferDock({ machine }: { machine: number }) {
  return <group position={[machineX(machine), 0, 0]}>
    <Box at={[0, 0.65, 0.56]} size={[2 * dockHalfWidth, 0.12, 1.12]} color="#536d7b" />
    {[-0.31, 0, 0.31].map(x =>
      <Box key={x} at={[x, 0.713, 0.57]} size={[0.045, 0.012, 0.98]} color="#b2c2c8" metal={0.4} />
    )}
    {[-0.43, 0.43].map(x =>
      <Box key={x} at={[x, 0.73, 0.64]} size={[0.045, 0.04, 0.85]} color="#c99a3c" />
    )}
    <Box at={[0, 0.3, 0.72]} size={[0.14, 0.58, 0.38]} color="#435863" />
  </group>;
}

function LineTerminal({ side }: { side: 'input' | 'output' }) {
  const x = side === 'input' ? materialLine.entry - 0.48 : materialLine.exit + 0.48;
  return <group position={[x, 0, materialLine.laneZ]}>
    <Box at={[0, 0.32, 0]} size={[0.89, 0.64, 0.83]} color="#5c7885" />
    <Box at={[0, 0.67, 0]} size={[0.96, 0.08, 0.89]} color="#8fa8b4" />
    {(side === 'input' ? [-0.42, 0.42] : [-0.42]).map(z =>
      <Box key={z} at={[0, 0.75, z]} size={[0.96, 0.12, 0.055]} color="#45636f" />
    )}
    <Box at={[side === 'input' ? -0.46 : 0.46, 0.75, 0]} size={[0.06, 0.12, 0.83]} color="#45636f" />
    <Box at={[0, 0.52, 0.426]} size={[0.45, 0.11, 0.022]} color={side === 'input' ? '#cc9b48' : '#569889'} />
  </group>;
}

type TransferPhase = 'travel' | 'load' | 'process' | 'unload' | 'output' | 'transfer' | 'packing' | 'shipping';

function moveToward(value: number, target: number, step: number) {
  return value + Math.sign(target - value) * Math.min(Math.abs(target - value), step);
}

// This pallet depicts the layout. It never changes JCST state or production metrics.
function DemonstrationPallet({ stations, moving }: { stations: ShopStation[]; moving: boolean }) {
  const pallet = useRef<Group>(null);
  const blank = useRef<Group>(null);
  const turned = useRef<Group>(null);
  const finished = useRef<Group>(null);
  const carton = useRef<Group>(null);
  const route = useRef({ station: 0, phase: 'travel' as TransferPhase, wait: 0 });

  useFrame((_, delta) => {
    if (!moving || !pallet.current) return;
    const state = route.current;
    const position = pallet.current.position;
    const dt = Math.min(delta, 0.06);
    const station = stations[state.station];
    const center = machineX(state.station);
    if (state.phase === 'travel') {
      const target = !station ? materialLine.exit + 0.48
        : station.status === 'Working' ? center : center - 0.68;
      // When a machine goes down after the pallet reaches its buffer, hold position.
      if (position.x < target) position.x = moveToward(position.x, target, 1.8 * dt);
      if (!station && position.x >= target) {
        state.phase = 'output';
        state.wait = 1.45;
      } else if (station?.status === 'Working' && position.x >= center) {
        state.phase = 'load';
      }
    } else if (state.phase === 'output') {
      state.wait -= dt;
      if (state.wait <= 0) state.phase = 'transfer';
    } else if (state.phase === 'transfer') {
      position.z = moveToward(position.z, 4.7, dt * 1.7);
      if (position.z === 4.7) state.phase = 'packing';
    } else if (state.phase === 'packing') {
      position.x = moveToward(position.x, 5.3, dt * 1.8);
      if (position.x === 5.3) {
        state.phase = 'shipping';
        state.wait = 1.2;
      }
    } else if (state.phase === 'shipping') {
      if (state.wait > 0) state.wait -= dt;
      else position.x = moveToward(position.x, 2.8, dt * 1.5);
      if (position.x === 2.8) {
        position.set(materialLine.entry - 0.48, materialLine.deckY, materialLine.laneZ);
        route.current = { station: 0, phase: 'travel', wait: 0 };
      }
    } else if (station?.status === 'Working') {
      if (state.phase === 'load') {
        position.z = moveToward(position.z, materialLine.dockZ, dt);
        if (position.z === materialLine.dockZ) {
          state.phase = 'process';
          state.wait = 1.25;
        }
      } else if (state.phase === 'process') {
        state.wait -= dt;
        if (state.wait <= 0) state.phase = 'unload';
      } else {
        position.z = moveToward(position.z, materialLine.laneZ, dt);
        if (position.z === materialLine.laneZ) {
          state.station++;
          state.phase = 'travel';
        }
      }
    }

    const stage = route.current.station + Number(route.current.phase === 'unload');
    if (blank.current) blank.current.visible = stage === 0;
    if (turned.current) turned.current.visible = stage === 1;
    const packed = route.current.phase === 'shipping';
    if (finished.current) finished.current.visible = stage >= 2 && !packed;
    if (carton.current) carton.current.visible = packed;
  });

  return <group ref={pallet} position={[materialLine.entry - 0.48, materialLine.deckY, materialLine.laneZ]}>
    <Box at={[0, 0.045, 0]} size={[0.46, 0.09, 0.43]} color="#416278" />
    <group ref={blank}><Box at={[0, 0.17, 0]} size={[0.33, 0.17, 0.31]} color="#b7c6cc" metal={0.45} /></group>
    <group ref={turned} visible={false}>
      <mesh position={[0, 0.17, 0]} castShadow>
        <cylinderGeometry args={[0.155, 0.155, 0.16, 18]} />
        <StationMaterial color="#bacad0" metalness={0.45} roughness={0.35} />
      </mesh>
    </group>
    <group ref={carton} visible={false}>
      <Box at={[0, 0.22, 0]} size={[0.4, 0.3, 0.36]} color="#bda077" />
      <Box at={[0, 0.377, 0]} size={[0.065, 0.015, 0.36]} color="#d2bb92" />
      <Box at={[0.205, 0.23, 0]} size={[0.012, 0.11, 0.17]} color="#ebebe4" />
    </group>
    <group ref={finished} visible={false}>
      <mesh position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.112, 0.04, 10, 22]} />
        <StationMaterial color="#bacad0" metalness={0.52} roughness={0.31} />
      </mesh>
    </group>
  </group>;
}

function MaterialLine({ stations, moving }: { stations: ShopStation[]; moving: boolean }) {
  const segmentEnds = [
    ...stations.map((_, machine) => machineX(machine) - dockHalfWidth),
    materialLine.exit,
  ];

  return <group>
    <LineTerminal side="input" />
    <StockCutter moving={moving} />
    {segmentEnds.map((end, index) => <RollerConveyor key={index}
      start={index === 0 ? materialLine.entry : machineX(index - 1) + dockHalfWidth} end={end} />)}
    {stations.map((_, machine) => <TransferDock key={machine} machine={machine} />)}
    <ConveyorCorner at={[8.18, 0, materialLine.laneZ]} />
    <BeltConveyor at={[8.18, 0, 2.71]} length={3.02} turn={Math.PI / 2} />
    <ConveyorCorner at={[8.18, 0, 4.7]} />
    <BeltConveyor at={[5.25, 0, 4.7]} length={4.9} />
    <HandlingRobot at={[6.5, 0, 5.95]} rotation={Math.PI / 2} moving={moving} />
    <PackingStation />
    <SafetyFence />
    <StorageRack at={[-8.5, 0, -2.15]} />
    <StorageRack at={[2.6, 0, 6.05]} cartons />
    <DemonstrationPallet stations={stations} moving={moving} />
  </group>;
}

function MaintenanceBay() {
  return <group position={[6.05, 0, -3.28]}>
    <Box at={[0, 0.96, 0]} size={[1.75, 0.13, 0.7]} color="#596d78" metal={0.27} />
    {[-0.73, 0.73].map(x => <Box key={x} at={[x, 0.47, 0]} size={[0.11, 0.93, 0.56]} color="#49616f" />)}
    <Box at={[0, 0.3, 0]} size={[1.4, 0.07, 0.55]} color="#677d88" />
    <Box at={[-0.48, 1.13, 0]} size={[0.48, 0.21, 0.3]} color="#be9140" />
    <Box at={[0.4, 1.08, 0]} size={[0.48, 0.11, 0.27]} color="#b1bfc5" />
    <Box at={[1.18, 0.62, -0.08]} size={[0.52, 1.24, 0.65]} color="#527784" />
    {[0.36, 0.7, 1.04].map(y =>
      <Box key={y} at={[1.18, y, 0.26]} size={[0.29, 0.043, 0.055]} color="#b3c0c6" />
    )}
  </group>;
}

function Technician({ index, machine, moving, justDispatched, arrivals, marker, selected, onSelect, layout }: {
  layout?: FactoryLayout;
  index: number; machine: number | null; moving: boolean; justDispatched: boolean;
  arrivals: RefObject<(number | null)[]>;
  marker: RefObject<HTMLButtonElement | null>; selected: boolean; onSelect: () => void;
}) {
  const { camera, size } = useThree();
  const markerPosition = useRef(new Vector3());
  const person = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const assigned = machine !== null;
  const homeX = (layout?.home[0] ?? 5.25) + index * 0.67;
  const homeZ = layout?.home[1] ?? serviceAisleZ;
  const mount = assigned ? cabinetMounts[machine] : null;
  const lowCabinet = mount !== null && mount.y < 0.65;
  const targetX = mount && assigned ? (layout?.stations[machine]?.x ?? machineX(machine)) + mount.x + (lowCabinet ? 0.4 : 0.55) : homeX;
  const targetZ = assigned ? (layout?.stations[machine]?.z ?? stationZ) + cabinetZ : homeZ;
  const initialPosition = useRef<Point>(assigned && !justDispatched
    ? [targetX, 0, targetZ] : [homeX, 0, homeZ]);
  const animationTime = useRef(0);
  const previousMachine = useRef(machine);
  const route = useRef<[number,number][]>([]);
  const routeDestination = useRef<string | undefined>(undefined);
  const walkingSpeed=useRef(9);
  useEffect(() => () => { arrivals.current[index] = null; }, [arrivals, index]);

  useFrame((_, delta) => {
    if (!person.current) return;
    const position = person.current.position;
    if (marker.current) {
      markerPosition.current.set(position.x, 1.79, position.z).project(camera);
      const { x, y, z } = markerPosition.current;
      marker.current.style.transform = `translate(${(x + 1) * size.width / 2}px, ${(1 - y) * size.height / 2}px) translate(-50%, -100%)`;
      marker.current.style.visibility = Math.abs(x) < 0.98 && Math.abs(y) < 0.98 && Math.abs(z) < 1 ? 'visible' : 'hidden';
    }
    if (assigned && machine !== previousMachine.current && !moving) position.set(targetX, 0, targetZ);
    previousMachine.current = machine;
    const arrivalTolerance = 0.025;
    const inTransit = Math.abs(targetX - position.x) > arrivalTolerance || Math.abs(targetZ - position.z) > arrivalTolerance;
    const walking = moving && inTransit;
    if (walking && layout) {
      const key = `${targetX}:${targetZ}`;
      if (routeDestination.current !== key) {
        route.current = technicianRoute(layout, [position.x,position.z], [targetX,targetZ]);
        let previous:[number,number]=[position.x,position.z], length=0;
        for(const point of route.current){length+=Math.hypot(point[0]-previous[0],point[1]-previous[1]);previous=point;}
        walkingSpeed.current=Math.max(9,length/1.1);
        routeDestination.current = key;
      }
      let budget=Math.min(delta,.065)*walkingSpeed.current;
      while(budget>0&&route.current.length){
        const next=route.current[0],dx=next[0]-position.x,dz=next[1]-position.z,distance=Math.hypot(dx,dz);
        if(distance<.001){route.current.shift();continue;}
        person.current.rotation.y=Math.atan2(dx,dz);
        const step=Math.min(distance,budget);
        position.x+=dx/distance*step;position.z+=dz/distance*step;budget-=step;
        if(step===distance)route.current.shift();
      }
    } else if (walking) {
      const step = Math.min(delta, 0.065) * 13;
      // Change aisles behind the cabinets, then approach the assigned machine from its right.
      if (Math.abs(targetX - position.x) > arrivalTolerance && position.z !== serviceAisleZ) {
        person.current.rotation.y = Math.PI;
        position.z = moveToward(position.z, serviceAisleZ, step);
      } else if (Math.abs(targetX - position.x) > arrivalTolerance) {
        person.current.rotation.y = Math.sign(targetX - position.x) * Math.PI / 2;
        position.x = moveToward(position.x, targetX, step);
      } else {
        person.current.rotation.y = targetZ > position.z ? 0 : Math.PI;
        position.z = moveToward(position.z, targetZ, step);
      }
    } else if (!inTransit) {
      person.current.rotation.y = assigned ? -Math.PI / 2 : 0;
    }

    const repairing = assigned && !inTransit;
    arrivals.current[index] = repairing ? machine : null;
    if (moving) animationTime.current += delta;
    const stride = Math.sin(animationTime.current * 19) * 0.52;
    legs.current.forEach((leg, legIndex) => {
      if (leg) leg.rotation.x = walking ? stride * (legIndex ? -1 : 1) : 0;
    });
    if (arm.current) arm.current.rotation.x = repairing
      ? (lowCabinet ? -0.26 : -1.42) + Math.sin(animationTime.current * 8) * (lowCabinet ? 0.08 : 0.18)
      : walking ? -stride * 0.5 : 0;
  });

  return <group ref={person} position={initialPosition.current} rotation={[0, assigned ? -Math.PI / 2 : 0, 0]}
    onClick={event => { event.stopPropagation(); onSelect(); }}>
    {selected && <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.28, 0.34, 24]} /><meshBasicMaterial color="#538bd5" />
    </mesh>}
    {[-0.1, 0.1].map((x, i) => <group key={x} position={[x, 0.69, 0]} ref={node => { legs.current[i] = node; }}>
      <Box at={[0, -0.28, 0]} size={[0.14, 0.54, 0.18]} color="#344756" />
      <Box at={[0, -0.59, 0.05]} size={[0.15, 0.1, 0.28]} color="#253442" />
    </group>)}
    <group>
      <Box at={[0, 0.92, 0]} size={[0.37, 0.51, 0.26]} color="#2b6176" />
      <Box at={[0, 0.83, 0.139]} size={[0.37, 0.075, 0.018]} color="#e5ae48" />
      <group ref={arm} position={[-0.25, 1.11, 0]}>
        <Box at={[0, -0.21, 0]} size={[0.12, 0.43, 0.15]} color="#427e90" />
        <Box at={[0, -0.43, 0.06]} size={[0.1, 0.14, 0.11]} color="#b18669" />
        {assigned && <Box at={[0, -0.5, 0.13]} size={[0.07, 0.21, 0.07]} color="#718692" metal={0.5} />}
        {lowCabinet && <Box at={[0, -0.685, 0.13]} size={[0.028, 0.19, 0.028]} color="#7f939c" metal={0.58} />}
      </group>
      <Box at={[0.25, 0.9, 0]} size={[0.12, 0.42, 0.15]} color="#427e90" />
      <mesh position={[0, 1.33, 0]} castShadow>
        <sphereGeometry args={[0.132, 14, 12]} />
        <StationMaterial color="#b18669" />
      </mesh>
      <mesh position={[0, 1.43, 0]} castShadow>
        <sphereGeometry args={[0.159, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <StationMaterial color="#e0a341" />
      </mesh>
      <Box at={[0, 1.43, 0.044]} size={[0.34, 0.035, 0.34]} color="#e0a341" />
    </group>
  </group>;
}

function SceneCamera({ reset, onUnavailable, layout }: { layout?: FactoryLayout; reset: number; onUnavailable: () => void }) {
  const { camera, gl, size } = useThree();
  const fit = Math.min(size.width / 25, size.height / 12.5);
  const controls = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.target.set(-0.25, 0.7, layout ? 0 : 1.75);
    orbit.enablePan = false;
    orbit.maxPolarAngle = Math.PI * 0.48;
    orbit.minPolarAngle = Math.PI * 0.18;
    orbit.update();
    controls.current = orbit;
    return () => { orbit.dispose(); controls.current = null; };
  }, [camera, gl, layout]);
  useEffect(() => {
    camera.position.set(...cameraHome);
    camera.zoom = fit;
    if (controls.current) {
      controls.current.minZoom = fit * 0.75;
      controls.current.maxZoom = fit * 2.3;
    }
    camera.updateProjectionMatrix();
    controls.current?.update();
  }, [camera, fit, reset]);
  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLoss = () => { if (canvas.isConnected) onUnavailable(); };
    canvas.addEventListener('webglcontextlost', handleContextLoss);
    return () => canvas.removeEventListener('webglcontextlost', handleContextLoss);
  }, [gl, onUnavailable]);
  return null;
}

function StationMarkers({ labels, stationCount, layout }: { layout?: FactoryLayout; labels: RefObject<(HTMLElement | null)[]>; stationCount: number }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    labels.current.forEach((label, machine) => {
      if (!label) return;
      if (machine < stationCount) {
        point.current.set(layout?.stations[machine]?.x ?? machineX(machine), stationLabelHeight[machine], layout?.stations[machine]?.z ?? stationZ);
      } else if (machine < stationCount + 2) {
        const terminalX = machine === stationCount ? materialLine.entry - 0.48 : materialLine.exit + 0.48;
        if (layout) { const node=machine===stationCount?layout.route[0]:layout.route.at(-1)!;point.current.set(node.x,.98,node.z); }
        else if (machine === stationCount) point.current.set(terminalX, 0.9, materialLine.laneZ);
        else point.current.set(2.8, 0.95, 4.7);
      } else {
        const labelIndex=machine-stationCount-2;
        if (layout) { const station=layout.stations[labelIndex];point.current.set(station.x,stationLabelHeight[labelIndex]+.5,station.z); }
        else point.current.set(...shopLabels[labelIndex].at);
      }
      point.current.project(camera);
      label.style.transform = `translate(${(point.current.x + 1) * size.width / 2}px, ${(1 - point.current.y) * size.height / 2}px) translate(-50%, -100%)`;
      const { x, y, z } = point.current;
      label.style.visibility = Math.abs(x) < 0.98 && Math.abs(y) < 0.98 && Math.abs(z) < 1 ? 'visible' : 'hidden';
    });
  });
  return null;
}

export default function FactoryPreviewScene({ layoutId, stations, technicians, selected, selectedTechnician, moving, reset, onSelect, onSelectTechnician, onUnavailable }: {
  layoutId?: string; stations: ShopStation[]; technicians: ShopTechnician[]; selected: number | null; selectedTechnician: number | null; moving: boolean;
  reset: number; onSelect: (machine: number) => void; onSelectTechnician: (technician: number) => void;
  onUnavailable: () => void;
}) {
  const layout = getFactoryLayout(layoutId);
  const alternative = layout;
  const displayLabels=alternative ? alternative.stations.map((station,i)=>({title:`0${i+1} · ${station.operation}`})) : shopLabels;
  const labels = useRef<(HTMLElement | null)[]>([]);
  const arrivals = useRef<(number | null)[]>([]);
  const technicianMarkers = useRef(technicians.map(() => ({ current: null as HTMLButtonElement | null })));
  const hasSelection = selected !== null || selectedTechnician !== null;
  return <>
    <Canvas orthographic shadows gl={{ alpha: true }} dpr={[1, 1.5]} camera={{ position: cameraHome, near: 0.1, far: 65 }}
      fallback={<p className="sim-twin-fallback">3D is unavailable on this device.</p>}>
      <hemisphereLight args={['#f7fbff', '#7d929d', 2]} />
      <directionalLight position={[-4, 8, 6]} intensity={2.6} castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={7} shadow-camera-bottom={-7} shadow-normalBias={0.03} />
      <StationMuted.Provider value={hasSelection}>
      <FactoryGround />
      {!alternative && <><Box at={[-0.65, 0.015, 1.96]} size={[18.6, 0.025, 0.07]} color="#c99a3c" />
      <Box at={[-0.65, 0.015, 2.58]} size={[18.6, 0.025, 0.07]} color="#c99a3c" />
      <Box at={[6.4, 0.012, -3.28]} size={[3.5, 0.025, 1.35]} color="#9eafb8" /></>}
      {stations.map(({ status }, machine) => <Station key={machine} placement={alternative?.stations[machine]} machine={machine} status={status}
        selected={selected === machine} muted={hasSelection && selected !== machine} moving={moving} arrivals={arrivals} onSelect={() => onSelect(machine)} />)}
      {alternative ? <WorkshopLine layout={alternative} stations={stations} moving={moving} /> : <><MaterialLine stations={stations} moving={moving} /><MaintenanceBay /></>}
      {technicians.map(({ machine, justDispatched }, index) => (
        <StationMuted.Provider key={index} value={hasSelection && selectedTechnician !== index}>
          <Technician layout={alternative} index={index} machine={machine} moving={moving} justDispatched={justDispatched} arrivals={arrivals}
            marker={technicianMarkers.current[index]} selected={selectedTechnician === index} onSelect={() => onSelectTechnician(index)} />
        </StationMuted.Provider>
      ))}
      </StationMuted.Provider>
      <SceneCamera layout={alternative} reset={reset} onUnavailable={onUnavailable} />
      <StationMarkers layout={alternative} labels={labels} stationCount={stations.length} />
    </Canvas>
    {stations.map(({ status }, machine) => <button key={machine} type="button"
      ref={button => { labels.current[machine] = button; }} className="sim-twin-marker"
      data-status={status} data-muted={hasSelection && selected !== machine}
      aria-label={`M${machine + 1} ${status}`} aria-pressed={selected === machine} onClick={() => onSelect(machine)}>
      <strong>M{machine + 1}</strong><span>{status}</span>
    </button>)}
    {[layout.inputLabel, layout.outputLabel].map((label, index) => (
      <span key={label} className="sim-twin-marker sim-twin-terminal" data-muted={hasSelection}
        ref={node => { labels.current[stations.length + index] = node; }}>{label}</span>
    ))}
    {technicians.map((technician, index) => <button key={index} type="button"
      ref={button => { technicianMarkers.current[index].current = button; }} className="sim-tech-marker"
      aria-label={`Inspect technician T${index + 1}`} aria-pressed={selectedTechnician === index}
      data-muted={hasSelection && selectedTechnician !== index} onClick={() => onSelectTechnician(index)}>
      T{index + 1}
    </button>)}
    {displayLabels.map(({ title }, index) => <span key={title}
      className="sim-twin-marker sim-twin-terminal" data-muted={hasSelection}
      ref={node => { labels.current[stations.length + 2 + index] = node; }}>{title}</span>)}
  </>;
}
