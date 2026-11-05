import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveApi, readError } from '@/lib/simulation/live-api';
import { authFetch } from '@/lib/auth';
import { observation, machineRead, incidentRead, incidents, simulation } from './live-simulation-fixtures';
vi.mock('@/lib/auth', () => ({authFetch: vi.fn(), endpoint: (path: string) => path}));
afterEach(() => vi.clearAllMocks());
describe('typed live API through HTTP transport', () => {
  it('reads an atomic revision with abort/no-store and no write', async () => {
    vi.mocked(authFetch).mockResolvedValue(Response.json({success: true, data: observation()})); const controller = new AbortController();
    const data = await liveApi.observation(simulation().id, 7, controller.signal);
    expect(data.revision).toBe(7); expect(authFetch).toHaveBeenCalledWith(`/api/v1/research/demo/sessions/${simulation().id}/observation?expectedRevision=7`, expect.objectContaining({method: 'GET', signal: controller.signal, cache: 'no-store'}));
  });
  it('rejects session/revision mismatch before exposing an observation', async () => {
    vi.mocked(authFetch).mockResolvedValue(Response.json({success: true, data: {...observation(), revision: 8}}));
    await expect(liveApi.observation(simulation().id, 7)).rejects.toMatchObject({status: 409});
  });
  it('rejects a different machine or incident identity', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(Response.json({success: true, data: machineRead('M3')}));
    await expect(liveApi.machine(simulation().id, 7, 'M1')).rejects.toMatchObject({status: 409});
    vi.mocked(authFetch).mockResolvedValueOnce(Response.json({success: true, data: incidentRead(incidents[0].incidentId)}));
    await expect(liveApi.incident(simulation().id, 7, 'other')).rejects.toMatchObject({status: 409});
  });
  it.each([401, 403, 404, 409, 500, 503])('preserves HTTP %s and surfaces a safe state', async status => {
    vi.mocked(authFetch).mockResolvedValue(Response.json({success: false, error: {code: 'DEMO_ERROR', message: 'safe API error'}}, {status}));
    const error = await liveApi.observation(simulation().id, 7).catch(error => error);
    expect(error.status).toBe(status); expect(readError(error)).not.toContain('safe API error');
  });
  it('network errors do not produce a fixture result', async () => {
    vi.mocked(authFetch).mockRejectedValue(new TypeError('offline'));
    await expect(liveApi.observation(simulation().id, 7)).rejects.toThrow('offline'); expect(readError(new TypeError('offline'))).toContain('connection');
  });
});
