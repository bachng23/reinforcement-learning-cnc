import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DemoWorkspace } from '@/components/simulation/demo-workspace';
import { ComparisonView } from '@/components/simulation/comparison-view';
import { researchRequest } from '@/lib/research-api/client';
import { getUserFromToken } from '@/lib/auth';
import { capabilities, simulation, observation, machineRead, incidentRead, incidents } from './live-simulation-fixtures';
import type { Simulation } from '@/lib/simulation/types';
const {push} = vi.hoisted(() => ({push: vi.fn()}));
vi.mock('next/navigation', () => ({useRouter: () => ({push})}));
vi.mock('@/components/app-shell', () => ({AppShell: ({children}: {children: ReactNode}) => <>{children}</>}));
vi.mock('@/lib/research-api/client', async importOriginal => ({...await importOriginal<typeof import('@/lib/research-api/client')>(), researchRequest: vi.fn()}));
vi.mock('@/lib/auth', () => ({getUserFromToken: vi.fn()}));
let current: Simulation;
function responder() {
  vi.mocked(researchRequest).mockImplementation(async path => {
    if (path === '/capabilities') return capabilities as never;
    if (path.endsWith('/commands')) {current = {...current, revision: current.revision + 1, status: 'RUNNING', pending: null}; return current as never;}
    if (path.includes('/observation?')) return observation(current) as never;
    if (path.includes('/machines/')) return machineRead(path.split('/machines/')[1].split('?')[0], current) as never;
    if (path.includes('/incidents/')) return incidentRead(decodeURIComponent(path.split('/incidents/')[1].split('?')[0]), current) as never;
    return current as never;
  });
}
const commands = () => vi.mocked(researchRequest).mock.calls.filter(([path]) => path.endsWith('/commands'));
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); window.history.replaceState(null, '', '/overview');
  vi.mocked(getUserFromToken).mockResolvedValue({id: 'engineer', role: 'ENGINEER'});
  current = simulation(); responder();
});
afterEach(() => vi.useRealTimers());
describe('live factory workspace', () => {
  it('restores REVIEW without POST/resume and approves its exact persisted revision', async () => {
    render(<DemoWorkspace view="decision" initialId={current.id}/>);
    await screen.findByText('Registered policy S recommends');
    await waitFor(() => expect(screen.getByRole('button', {name: 'Approve & dispatch'})).toBeEnabled());
    expect(screen.getByRole('button', {name: 'Run simulator'})).toBeDisabled(); expect(commands()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', {name: 'Approve & dispatch'}));
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0][1]?.body).toEqual({revision: 7, command: 'approve', reason: 'Accept the validated policy matching for this simulation.'});
    expect(push).toHaveBeenCalledWith(expect.stringContaining(`/overview?session=${current.id}`));
  });
  it('creates via the real typed request path and does not offer timed Auto demo', async () => {
    current = {...current, status: 'RUNNING', pending: null};
    render(<DemoWorkspace/>);
    const button = await screen.findByRole('button', {name: 'Create simulation'}); await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(researchRequest).toHaveBeenCalledWith('/demo/sessions', expect.objectContaining({body: {case: 'base', seed: '990000001', mode: 'incident', primary: 'S', baseline: 'F'}, key: expect.any(String), signal: expect.any(AbortSignal)})));
    expect(screen.queryByRole('button', {name: 'Auto demo'})).not.toBeInTheDocument(); expect(commands()).toHaveLength(0);
  });
  it('renders the API map and opens the exact machine; Escape restores focus and body scrolling', async () => {
    render(<DemoWorkspace initialId={current.id}/>);
    const trigger = await screen.findByRole('button', {name: 'Inspect machine M3'}); await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('DEMO-PH-001 · Pump housing')).toBeInTheDocument();
    expect(within(dialog).getByText('Zone B · Bay B1')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    expect(window.location.search).toContain('machine=M3');
    await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus(); expect(document.body.style.overflow).not.toBe('hidden');
    expect(commands()).toHaveLength(0);
  });
  it('opens a deep-linked incident at its original tick and keeps current machine state distinct', async () => {
    const resolved = incidents.find(incident => incident.status === 'RESOLVED')!;
    window.history.replaceState(null, '', `/overview?session=${current.id}&machine=${resolved.machineId}&incident=${encodeURIComponent(resolved.incidentId)}`);
    render(<DemoWorkspace/>);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(`Failure · tick ${resolved.openedAtTick}`)).toBeInTheDocument();
    expect(within(dialog).getByText(`Completion · tick ${resolved.resolvedAtTick}`)).toBeInTheDocument();
    expect(within(dialog).getByText(/current tick 7/)).toBeInTheDocument(); expect(commands()).toHaveLength(0);
  });
  it('does not substitute context on an API read error; retry reads only', async () => {
    let fail = true; const original = vi.mocked(researchRequest).getMockImplementation()!;
    vi.mocked(researchRequest).mockImplementation(async (path, options) => {
      if (path.includes('/observation?') && fail) throw Object.assign(new Error('unavailable'), {status: 503});
      return original(path, options);
    });
    render(<DemoWorkspace initialId={current.id}/>);
    expect(await screen.findByText(/Simulation service unavailable/)).toBeInTheDocument(); expect(screen.queryByRole('button', {name: 'Inspect machine M1'})).not.toBeInTheDocument();
    fail = false; await userEvent.click(screen.getByRole('button', {name: 'Retry observation'}));
    expect(await screen.findByRole('button', {name: 'Inspect machine M1'})).toBeInTheDocument(); expect(commands()).toHaveLength(0);
  });
  it('on stale approval refetches, preserves the conflict warning and never retries against the new revision', async () => {
    const original = vi.mocked(researchRequest).getMockImplementation()!;
    vi.mocked(researchRequest).mockImplementation(async (path, options) => {
      if (path.endsWith('/commands')) {current = {...current, revision: 8}; throw Object.assign(new Error('stale'), {status: 409});}
      return original(path, options);
    });
    render(<DemoWorkspace view="decision" initialId={current.id}/>);
    const approve = await screen.findByRole('button', {name: 'Approve & dispatch'}); await waitFor(() => expect(approve).toBeEnabled()); await userEvent.click(approve);
    expect(await screen.findByText(/Session revision changed/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/revision 8/)).toBeInTheDocument()); expect(commands()).toHaveLength(1); expect(push).not.toHaveBeenCalled();
  });
  it('recovers a lost command response with identical key/body and blocks double submit', async () => {
    let fail = true; const original = vi.mocked(researchRequest).getMockImplementation()!;
    vi.mocked(researchRequest).mockImplementation(async (path, options) => {
      if (path.endsWith('/commands') && fail) {fail = false; throw new TypeError('lost response');}
      return original(path, options);
    });
    render(<DemoWorkspace view="decision" initialId={current.id}/>);
    const approve = await screen.findByRole('button', {name: 'Approve & dispatch'}); await waitFor(() => expect(approve).toBeEnabled()); await userEvent.dblClick(approve);
    await screen.findByRole('button', {name: 'Retry same command'}); expect(commands()).toHaveLength(1); expect(approve).toBeDisabled();
    await userEvent.click(screen.getByRole('button', {name: 'Reload session'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Retry same command'})).toBeEnabled());
    await userEvent.click(screen.getByRole('button', {name: 'Retry same command'})); await waitFor(() => expect(commands()).toHaveLength(2));
    expect(commands()[0][1]?.body).toEqual(commands()[1][1]?.body); expect(commands()[0][1]?.key).toBe(commands()[1][1]?.key);
  });
  it('keeps VIEWER read-only and clears old actor data during an identity check', async () => {
    vi.mocked(getUserFromToken).mockResolvedValue({id: 'viewer', role: 'VIEWER'});
    render(<DemoWorkspace initialId={current.id}/>);
    await screen.findByRole('button', {name: 'Inspect machine M1'}); expect(screen.getByRole('button', {name: 'Step'})).toBeDisabled();
    let resolve!: (value: null) => void; vi.mocked(getUserFromToken).mockReturnValue(new Promise(done => {resolve = done;}));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByRole('button', {name: 'Inspect machine M1'})).not.toBeInTheDocument();
    await act(async () => resolve(null)); expect(await screen.findByText(/Sign in to view and control/)).toBeInTheDocument(); expect(commands()).toHaveLength(0);
  });
  it('keeps human override comparison and actual cost ordering unchanged', () => {
    current.primary.overrides = 1; current.primary.total_cost = 150; current.baseline.total_cost = 100;
    render(<ComparisonView session={current}/>);
    expect(screen.getByText('F has lower cost in this trajectory')).toBeInTheDocument(); expect(screen.getByText(/not an automatic-policy comparison/)).toBeInTheDocument(); expect(screen.getByText('Partial trajectory')).toBeInTheDocument();
  });
  it('shows missing machine context without quantity/deadline or a fabricated profile', async () => {
    const original = vi.mocked(researchRequest).getMockImplementation()!;
    vi.mocked(researchRequest).mockImplementation(async(path, options) => path.includes('/machines/') ? {...machineRead('M3'), context: null, profile: null, assignedBatch: null, contextStatus: 'MISSING_LEGACY', contextOrigin: null, contextVersion: null} as never : original(path, options));
    render(<DemoWorkspace initialId={current.id}/>);
    await userEvent.click(await screen.findByRole('button', {name: 'Inspect machine M3'}));
    const dialog = screen.getByRole('dialog'); expect(await within(dialog).findByText(/Machine context not available/)).toBeInTheDocument();
    expect(within(dialog).queryByText('DEMO-PH-001')).not.toBeInTheDocument(); expect(within(dialog).queryByText('Quantity')).not.toBeInTheDocument(); expect(within(dialog).queryByText('Deadline')).not.toBeInTheDocument();
  });
  it('machine loading and unauthorized errors never show old profile metadata', async () => {
    let reject!: (reason: unknown) => void; const original = vi.mocked(researchRequest).getMockImplementation()!;
    vi.mocked(researchRequest).mockImplementation(async(path, options) => path.includes('/machines/') ? await new Promise<never>((_, fail) => {reject = fail;}) : original(path, options));
    render(<DemoWorkspace initialId={current.id}/>);
    await userEvent.click(await screen.findByRole('button', {name: 'Inspect machine M3'}));
    const dialog = screen.getByRole('dialog'); expect(within(dialog).getByText('Loading machine profile…')).toBeInTheDocument();
    await act(async() => reject({status: 403})); expect(await within(dialog).findByText(/do not have permission/)).toBeInTheDocument();
    expect(within(dialog).queryByText('DEMO-PH-001')).not.toBeInTheDocument(); expect(commands()).toHaveLength(0);
  });
  it('server authorization rejection fails closed rather than retaining a submit recovery action', async () => {
    const original = vi.mocked(researchRequest).getMockImplementation()!;
    vi.mocked(researchRequest).mockImplementation(async(path, options) => {if (path.endsWith('/commands')) throw {status: 403}; return original(path, options);});
    render(<DemoWorkspace view="decision" initialId={current.id}/>);
    const approve = await screen.findByRole('button', {name: 'Approve & dispatch'}); await waitFor(() => expect(approve).toBeEnabled()); await userEvent.click(approve);
    expect(await screen.findByText(/do not have permission/)).toBeInTheDocument(); expect(approve).toBeDisabled(); expect(screen.queryByRole('button', {name: 'Retry same command'})).not.toBeInTheDocument();
  });
});
