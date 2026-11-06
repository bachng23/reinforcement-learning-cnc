'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Box, RotateCcw, Wrench, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import type { Config } from '@/types/generated/jcst';
import type { Lane, Matching, Simulation } from '@/lib/simulation/types';
import { serviceDuration, simulationTime } from '@/lib/simulation/clock';
import type { FactoryLayout } from '@/lib/simulation/factory-layouts';
import { demoMachines } from './machine-detail';
import type { PreviewStatus } from './factory-preview-scene';

const Scene = dynamic(() => import('./factory-preview-scene'), {
  ssr: false,
  loading: () => <p className="sim-twin-fallback" role="status">Loading 3D view…</p>,
});

export function FactoryPreview({ layout, lane, config, proposal, running, clockSession, selected, onSelect, onInspect, onUnavailable }: {
  layout?: FactoryLayout;
  lane: Lane;
  clockSession?: Pick<Simulation, 'simulation_start' | 'step_seconds'>;
  config: Config;
  proposal?: Matching;
  running: boolean;
  selected: number | null;
  onSelect: (machine: number | null) => void;
  onInspect: (machine: number) => void;
  onUnavailable: () => void;
}) {
  const [selectedTechnician, setSelectedTechnician] = useState<number | null>(null);
  useEffect(() => {
    if (selected !== null) setSelectedTechnician(null);
  }, [selected]);

  function selectMachine(machine: number | null) {
    setSelectedTechnician(null);
    onSelect(machine);
  }

  function selectTechnician(technician: number) {
    onSelect(null);
    setSelectedTechnician(technician);
  }

  const [reset, setReset] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [webGlReady, setWebGlReady] = useState(false);

  useEffect(() => {
    const context = document.createElement('canvas').getContext('webgl2');
    if (!context) {
      onUnavailable();
      return;
    }
    context.getExtension('WEBGL_lose_context')?.loseContext();
    setWebGlReady(true);
  }, [onUnavailable]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(preference.matches);
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);

  const { state, records } = lane;
  const events = records.flatMap(record => record.events);
  const stations = state.components.map((components, machine) => {
    const job = state.jobs.find(active => active?.machine === machine);
    const failed = components.flatMap((component, index) => component.failed ? [`C${index + 1}`] : []);
    const status: PreviewStatus = job ? 'In service' : failed.length ? 'Breakdown' : 'Working';
    const assignment = proposal?.find(([destination]) => destination === machine);
    const latestFailure = events.findLast(event => event.type === 'failure' && event.machine === machine);
    return { status, failed, job, assignment, latestFailure };
  });
  const station = selected === null ? null : stations[selected];
  const moving = running && !reduceMotion;
  const technicians = state.jobs.map((job, technician) => ({
    machine: job?.machine ?? null,
    justDispatched: Boolean(job && moving && records.at(-1)?.events.some(event =>
      event.type === 'start' && event.technician === technician,
    )),
  }));

  return <div className="sim-twin-layout">
    <div className="sim-twin-stage">
      {webGlReady && <ErrorBoundary fallback={<PreviewUnavailable onUnavailable={onUnavailable} />}>
        <Scene layoutId={layout?.id} stations={stations} technicians={technicians} selected={selected} selectedTechnician={selectedTechnician} moving={moving}
          reset={reset} onSelect={selectMachine} onSelectTechnician={selectTechnician} onUnavailable={onUnavailable} />
      </ErrorBoundary>}
      <button className="sim-button sim-twin-reset" type="button" onClick={() => setReset(value => value + 1)}>
        <RotateCcw size={14} aria-hidden="true" /> Reset view
      </button>
    </div>
    {station && selected !== null && <aside className="sim-twin-inspector" aria-label={`Machine M${selected + 1} status`}>
        <div className="sim-twin-inspector-header">
          <p className="sim-twin-kicker"><Box size={15} aria-hidden="true" /> Station M{selected + 1}</p>
          <button className="sim-button" type="button" aria-label="Close machine panel" onClick={() => selectMachine(null)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <h3>{layout?.stations[selected]?.name ?? demoMachines[selected]?.name ?? 'Machine'}</h3>
        <span className="sim-twin-status" data-status={station.status}>{station.status}</span>
        <dl>
          <div><dt>Components</dt><dd>{station.failed.length ? `${station.failed.join(', ')} failed` : 'All healthy'}</dd></div>
          {station.failed.length > 0 && station.latestFailure && <div><dt>Latest failure</dt><dd>{simulationTime(clockSession ?? {},station.latestFailure.tick).time}</dd></div>}
          <div><dt>Technician</dt><dd>{station.job ? `T${station.job.technician + 1}` : station.assignment ? `T${station.assignment[2] + 1} proposed` : 'Unassigned'}</dd></div>
          {station.job && <div><dt>Time remaining</dt><dd>{serviceDuration(station.job.remaining,clockSession?.step_seconds)}</dd></div>}
        </dl>
        <button className="sim-button" type="button" onClick={() => onInspect(selected)}>Inspect machine</button>
    </aside>}
    {selectedTechnician !== null && selected === null && <TechnicianDetails
      technician={selectedTechnician} clockSession={clockSession} lane={lane} config={config} proposal={proposal}
      onClose={() => setSelectedTechnician(null)} onSelectMachine={selectMachine} />}
  </div>;
}

function TechnicianDetails({ technician, lane, config, proposal, onClose, onSelectMachine, clockSession }: {
  clockSession?: Pick<Simulation, 'simulation_start' | 'step_seconds'>;
  technician: number; lane: Lane; config: Config; proposal?: Matching;
  onClose: () => void; onSelectMachine: (machine: number) => void;
}) {
  const job = lane.state.jobs[technician];
  const pending = proposal?.find(([, , worker]) => worker === technician);
  const history = lane.records.flatMap(record => record.events)
    .filter(event => event.type === 'completion' && event.technician === technician);
  const qualifications = config.duration.flatMap((components, machine) =>
    components.map((durations, component) => ({ machine, component, duration: durations[technician] })),
  );
  const qualified = qualifications.filter(({ duration }) => duration > 0).length;
  return <aside className="sim-twin-inspector sim-technician-inspector" aria-label={`Technician T${technician + 1} details`}>
    <div className="sim-twin-inspector-header">
      <p className="sim-twin-kicker"><Wrench size={15} aria-hidden="true" /> Maintenance team</p>
      <button type="button" className="sim-button" aria-label="Close technician panel" onClick={onClose}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
    <h3>Technician T{technician + 1}</h3>
    <span className="sim-twin-status" data-status={job ? 'In service' : 'Working'}>{job ? 'In service' : 'Available'}</span>
    <dl>
      <div><dt>Current assignment</dt><dd>{job ? `M${job.machine + 1} / C${job.component + 1}` : 'Unassigned'}</dd></div>
      {job && <>
        <div><dt>Service</dt><dd>{job.kind === 'CM' ? 'Corrective' : 'Preventive'}</dd></div>
        <div><dt>Time remaining</dt><dd>{serviceDuration(job.remaining,clockSession?.step_seconds)}</dd></div>
      </>}
      {!job && pending && <div><dt>Proposed assignment</dt><dd>M{pending[0] + 1} / C{pending[1] + 1}</dd></div>}
      <div><dt>Jobs completed</dt><dd>{lane.completed_jobs?.[technician] ?? history.length}</dd></div>
    </dl>
    <h4 className="sim-tech-qualification-title">Qualifications <span>{qualified} / {qualifications.length} components</span></h4>
    <table className="sim-tech-qualifications">
      <thead><tr><th scope="col">Component</th><th scope="col">Service time</th></tr></thead>
      <tbody>{qualifications.map(({ machine, component, duration }) => <tr key={`${machine}-${component}`}>
        <th scope="row">M{machine + 1} / C{component + 1}</th>
        <td>{duration > 0 ? serviceDuration(duration,clockSession?.step_seconds) : 'Not qualified'}</td>
      </tr>)}</tbody>
    </table>
    {job && <button type="button" className="sim-button" onClick={() => onSelectMachine(job.machine)}>View assigned machine</button>}
  </aside>;
}

function PreviewUnavailable({ onUnavailable }: { onUnavailable: () => void }) {
  useEffect(onUnavailable, [onUnavailable]);
  return <p role="status" className="sim-twin-fallback">Returning to the 2D view…</p>;
}
