import { authFetch, endpoint } from '@/lib/auth';
import type { Bundle, Episode } from '@/types/generated/jcst';

export type EpisodeIndex = {
  id: string; episodeKey: string; caseId: string; controller: string; physicalSeed: string;
  contentHash: string; horizon: number; tail: number; controlledCost: number; tailCost: number; totalCost: number;
};
export type ArtifactIndex = { id: string; artifactKey: string; contentHash: string; mediaType: string; byteLength: number };
export type Run = {
  id: string; studyKey: string; runKey: string; origin: 'engineering' | 'research'; bundleHash: string;
  metadataJson: Omit<Bundle, 'episodes' | 'artifacts'> & Required<Pick<Bundle, 'curves' | 'contrasts' | 'claims' | 'limitations' | 'source_audits'>>;
  physicalReplayJson: { status: string; scope: string; records: number }[];
  episodes: EpisodeIndex[]; artifacts: ArtifactIndex[];
};
export type Campaign = { id: string; title: string; objective: string; campaignKey: string; createdAt: string; runs: Run[]; _count?: { runs: number } };
export type Job = {
  id: string; kind: 'IMPORT' | 'BRANCH' | 'INFER'; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  errorCode: string | null; createdAt: string;
  inputJson: { reason?: string; tick?: number; action?: number[][]; controller?: string };
  outputJson: null | { campaignId?: string; runId?: string; deltaTotalCost?: number; baselineTotalCost?: number; branchTotalCost?: number; note?: string; action?: number[][]; arm?: string; checkpoint_sha256?: string };
  reviews?: { decision: string; reason: string; createdAt: string }[];
};

export async function researchRequest<T>(path: string, options: { signal?: AbortSignal; body?: unknown; key?: string } = {}): Promise<T> {
  const response = await authFetch(endpoint(`/api/v1/research${path}`), {
    method: options.body === undefined ? 'GET' : 'POST', signal: options.signal, cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.key ? { 'Idempotency-Key': options.key } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) throw new Error(payload.error?.message || `Research API failed (${response.status})`);
  return payload.data as T;
}

export const researchApi = {
  campaigns: (signal?: AbortSignal) => researchRequest<Campaign[]>('/campaigns?limit=100', { signal }),
  campaign: (id: string, signal?: AbortSignal) => researchRequest<Campaign>(`/campaigns/${encodeURIComponent(id)}`, { signal }),
  jobs: (signal?: AbortSignal) => researchRequest<Job[]>('/jobs?limit=100', { signal }),
  job: (id: string, signal?: AbortSignal) => researchRequest<Job>(`/jobs/${encodeURIComponent(id)}`, { signal }),
  episode: (id: string, signal?: AbortSignal) => researchRequest<Episode>(`/episodes/${encodeURIComponent(id)}/records?limit=100`, { signal }),
  episodePage: (id: string, page: number, signal?: AbortSignal) => researchRequest<Episode>(`/episodes/${encodeURIComponent(id)}/records?limit=100&page=${page}`, { signal }),
};

export async function canonicalHash(value: unknown): Promise<string> {
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
    : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
    : JSON.stringify(v);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
