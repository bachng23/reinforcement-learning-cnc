import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FactoryMap } from '@/components/simulation/factory-map';
import { IncidentCenter } from '@/components/simulation/incident-center';
import { IncidentTimeline } from '@/components/simulation/incident-timeline';
import { useLiveRead } from '@/lib/simulation/use-live-read';
import { observation, incidents, simulation } from './live-simulation-fixtures';
beforeEach(() => localStorage.clear());
describe('API observation presentation', () => {
  it('places API machines on their own coordinates and exposes state labels', () => {
    const data = observation(); const inspect = vi.fn(); render(<FactoryMap observation={data} onInspect={inspect}/>);
    expect(screen.getByRole('button', {name: 'Inspect machine M3'})).toHaveStyle({gridColumn: '3', gridRow: '2'});
    expect(screen.getByText('Breakdown')).toBeInTheDocument(); expect(screen.getByText('M1 → M2 → M3')).toBeInTheDocument();
  });
  it('missing context renders a list with no invented location/profile', () => {
    const data = observation(); data.context = null; data.contextStatus = 'MISSING_LEGACY'; data.contextVersion = null; data.contextOrigin = null;
    render(<FactoryMap observation={data} onInspect={vi.fn()}/>);
    expect(screen.getByLabelText('Machine list')).toBeInTheDocument(); expect(screen.queryByText('CNC turning center')).not.toBeInTheDocument(); expect(screen.getByText(/Machine list shown without invented/)).toBeInTheDocument();
  });
  it('empty API lists show explicit empty states', () => {
    const data = observation(); data.machines = [];
    render(<><FactoryMap observation={data} onInspect={vi.fn()}/><IncidentCenter scope="empty" incidents={[]} onInspect={vi.fn()}/></>);
    expect(screen.getByText('No machines returned for this session revision.')).toBeInTheDocument(); expect(screen.getByText('No incidents match this filter.')).toBeInTheDocument();
  });
  it('filters status and selects separate recurring incidents, with browser-local read flags only', async () => {
    const open = incidents.find(incident => incident.status === 'OPEN')!;
    const recurrence = {...open, incidentId: open.incidentId + '-recurrence', openedAtTick: 12}; const inspect = vi.fn();
    render(<IncidentCenter scope="actor:session" incidents={[...incidents, recurrence]} onInspect={inspect}/>);
    await userEvent.click(screen.getByRole('button', {name: `Inspect incident ${open.machineId}/${open.componentId} at tick 12`})); expect(inspect).toHaveBeenCalledWith(recurrence);
    await userEvent.selectOptions(screen.getByLabelText('Incident status'), 'RESOLVED');
    expect(screen.queryByRole('button', {name: /at tick 12/})).not.toBeInTheDocument(); expect(within(screen.getByRole('list')).getByText('Resolved')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('jcst-read:actor:session')!)).toEqual([recurrence.incidentId]); expect(open.status).toBe('OPEN');
  });
  it('old resolved incident keeps its own evidence and unknown stages have no fabricated ticks', () => {
    const resolved = incidents.find(incident => incident.status === 'RESOLVED')!;
    render(<IncidentTimeline incident={resolved} session={simulation()}/>);
    expect(screen.getByText(`Failure · tick ${resolved.openedAtTick}`)).toBeInTheDocument(); expect(screen.getByText(`Completion · tick ${resolved.resolvedAtTick}`)).toBeInTheDocument();
    expect(screen.getByText('Policy proposal / review · Not linked')).toBeInTheDocument();
  });
  it('pending stages remain pending until their physical evidence exists', () => {
    const open = incidents.find(incident => incident.status === 'OPEN')!; render(<IncidentTimeline incident={open} session={simulation()}/>);
    expect(screen.getByText('Start CM · Pending')).toBeInTheDocument(); expect(screen.getByText('Completion · Pending')).toBeInTheDocument();
  });
  it('late response cannot overwrite a new selection, even if the transport ignores abort', async () => {
    const deferred: Record<string, (value: string) => void> = {}; const signals: AbortSignal[] = [];
    const reader = (key: string, signal: AbortSignal) => {signals.push(signal); return new Promise<string>(resolve => {deferred[key] = resolve;});};
    const hook = renderHook(({key}) => useLiveRead(key, signal => reader(key, signal)), {initialProps: {key: 'M1:r1'}});
    hook.rerender({key: 'M3:r2'}); expect(signals[0].aborted).toBe(true); expect(hook.result.current.data).toBeUndefined();
    await act(async () => deferred['M3:r2']('current machine')); await act(async () => deferred['M1:r1']('old machine'));
    expect(hook.result.current.data).toBe('current machine'); hook.unmount(); expect(signals[1].aborted).toBe(true);
  });
});
