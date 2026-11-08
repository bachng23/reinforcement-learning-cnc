"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { researchApi, researchRequest, type EpisodeIndex, type Job } from '@/lib/research-api/client';
import { useResource } from '@/lib/research-api/use-resource';
import type { Episode, Record as TickRecord } from '@/types/generated/jcst';
import { ResearchShell, EvidenceBadge } from './research-shell';
import { AsyncState } from './async-state';

export function EpisodeReplay({ id }: { id: string }) {
  const resource = useResource(`episode:${id}`, async signal => {
    const [index, first] = await Promise.all([
      researchRequest<EpisodeIndex>(`/episodes/${encodeURIComponent(id)}`, { signal }), researchApi.episode(id, signal),
    ]);
    if (first.horizon + first.tail > 100) {
      const next = await researchApi.episodePage(id, 2, signal);
      first.records = [...first.records, ...next.records] as Episode['records'];
    }
    return { index, episode: first };
  });
  const [tick, setTick] = useState(0); const [playing, setPlaying] = useState(false);
  const [boundary, setBoundary] = useState<'before' | 'after'>('after');
  const [releaseId, setReleaseId] = useState('');
  const capabilities = useResource('jcst-capabilities', signal => researchRequest<{ learned_releases: {release_id:string; arm:string; case_id:string; available:boolean}[] }>('/capabilities', {signal}));
  const [action, setAction] = useState('[]'); const [reason, setReason] = useState(''); const [controller, setController] = useState('risk');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [job, setJob] = useState<Job>();
  const submission = useRef<{ input: string; key: string } | null>(null);
  useEffect(() => { setTick(0); setPlaying(false); setJob(undefined); }, [id]);
  useEffect(() => { setAction('[]'); }, [tick,id]);
  useEffect(() => {
    if (!playing || !resource.data) return;
    const length = resource.data.episode.records.length;
    const timer = setInterval(() => setTick(t => {
      if (t >= length - 1) { setPlaying(false); return t; }
      return t + 1;
    }), 700);
    return () => clearInterval(timer);
  }, [playing, resource.data]);
  const episode = resource.data?.episode; const record = episode?.records[tick];
  async function branch() {
    if (!resource.data) return;
    setBusy(true); setError('');
    try {
      const body = { episode_id: id, tick, action: JSON.parse(action), reason, controller,
        expected_episode_hash: resource.data.index.contentHash };
      const input = JSON.stringify(body);
      if (submission.current?.input !== input) submission.current = { input, key: crypto.randomUUID() };
      setJob(await researchRequest<Job>('/branches', { body, key: submission.current!.key }));
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <ResearchShell title="Episode replay" description="Recorded JCST component states and technician commitments. Physical ticks and simulation cost units are retained.">
    {resource.error ? <AsyncState kind="error" description={resource.error} onRetry={resource.reload} /> : !episode || !record ? <AsyncState kind="loading" /> : <>
      <div className="flex flex-wrap gap-3"><EvidenceBadge>{episode.case_id} / {episode.controller}</EvidenceBadge><EvidenceBadge>{episode.seed_role}</EvidenceBadge><EvidenceBadge>Physical seed {episode.physical_seed}</EvidenceBadge><EvidenceBadge>H {episode.controlled_cost} + tail {episode.tail_cost} = {episode.total_cost}</EvidenceBadge></div>
      <section className="space-y-4 rounded border bg-white p-5"><div className="flex flex-wrap items-center gap-3"><button className="rounded border px-4 py-2 text-sm" onClick={() => setPlaying(v => !v)}>{playing ? 'Pause' : 'Play'}</button><button className="rounded border px-4 py-2 text-sm" onClick={() => { setPlaying(false); setTick(t => Math.min(t+1, episode.records.length-1)); }}>Step</button><button className="rounded border px-4 py-2 text-sm" onClick={() => { setPlaying(false); setTick(0); }}>Reset</button><strong className="text-sm">Tick {record.tick} · {record.phase === 'H' ? 'controlled horizon' : 'fixed-risk tail'}</strong></div>
      <label className="block text-sm">Physical tick<input aria-label="Physical tick" type="range" min={0} max={episode.records.length-1} value={tick} onChange={e => { setPlaying(false); setTick(Number(e.target.value)); }} className="mt-2 block w-full" /></label></section>
      <label className="block text-sm">State boundary<select className="ml-3 rounded border p-2" value={boundary} onChange={e => setBoundary(e.target.value as typeof boundary)}><option value="before">Before selected action</option><option value="after">After interval</option></select></label>
      <StateView record={record} boundary={boundary} />
      <div className="grid gap-4 md:grid-cols-2"><section className="rounded border bg-white p-5"><h2 className="font-semibold">Selected matching</h2><p className="mt-3 font-mono text-sm">{record.action.length ? record.action.map(([m,c,j]) => `M${m+1}/C${c+1} → T${j+1}`).join(' · ') : 'WAIT'}</p><p className="mt-2 text-xs text-ash-gray">{record.catalogue.length} legal complete matchings including WAIT</p><h3 className="mt-5 text-sm font-semibold">Interval cost: {record.cost}</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-sm">{Object.entries(record.breakdown).map(([key,value]) => <div key={key}><dt className="text-ash-gray">{key}</dt><dd>{value}</dd></div>)}</dl></section>
      <section className="rounded border bg-white p-5"><h2 className="font-semibold">Physical events</h2>{record.events.length ? <ul className="mt-3 space-y-2 text-sm">{record.events.map((e,i) => <li key={i}>t{e.tick} · {e.type} · M{e.machine+1}/C{e.component+1}{e.technician == null ? '' : ` · T${e.technician+1}`}{e.remaining == null ? '' : ` · ${e.remaining} ticks remaining`}</li>)}</ul> : <p className="mt-3 text-sm text-ash-gray">No events in this interval.</p>}</section></div>
      <details className="rounded border p-5"><summary className="cursor-pointer font-semibold">Create a simulation branch from tick {tick}</summary><p className="mt-3 text-sm text-ash-gray">Choose an allowed matching before advancing the copied state. Continuation uses the selected control and the same physical noise. Original evidence remains immutable.</p>
      {record.phase === 'tail' ? <p className="mt-3 text-sm">Overrides are available only within H.</p> : <div className="mt-4 space-y-4"><label className="block text-sm">Override matching<select aria-label="Override matching" className="mt-2 block w-full rounded border p-2 font-mono" value={action} onChange={e => setAction(e.target.value)}>{record.catalogue.map((a,i) => <option key={i} value={JSON.stringify(a)}>{a.length ? a.map(([m,c,j]) => `M${m+1}/C${c+1} → T${j+1}`).join(' · ') : 'WAIT'}</option>)}</select></label><label className="block text-sm">Continuation controller<select className="ml-3 rounded border p-2" value={controller} onChange={e => setController(e.target.value)}>{['risk','threshold5','corrective','wait'].map(c => <option key={c}>{c}</option>)}</select></label><label className="block text-sm">Reason<textarea className="mt-2 block w-full rounded border p-2" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="rounded bg-slate-text px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy || !reason.trim()} onClick={branch}>{busy ? 'Submitting…' : 'Run simulation branch'}</button></div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}{job?.kind === 'BRANCH' && <Link className="mt-3 block text-sm text-chartwell-blue underline" href={`/research/jobs?job=${job.id}`}>Follow branch {job.status.toLowerCase()} →</Link>}</details>
      <section className="rounded border bg-white p-5"><h2 className="font-semibold">Registered S/F/A inference</h2><p className="mt-2 text-sm text-ash-gray">Compare a registered checkpoint at the before-action boundary. This only reads the state and returns a validated matching.</p>
        {capabilities.error ? <p className="mt-3 text-sm">Policy runtime unavailable: {capabilities.error}</p> : !capabilities.data?.learned_releases.some(r => r.available && r.case_id === episode.case_id) ? <p className="mt-3 text-sm text-ash-gray">No compatible learned checkpoint is configured. Recorded replay and reference controls remain available.</p> : <div className="mt-3 flex flex-wrap gap-3"><select aria-label="Registered checkpoint" className="rounded border p-2 text-sm" value={releaseId} onChange={e => setReleaseId(e.target.value)}><option value="">Choose checkpoint</option>{capabilities.data.learned_releases.filter(r => r.available && r.case_id === episode.case_id).map(r => <option key={r.release_id} value={r.release_id}>{r.arm} · {r.release_id}</option>)}</select><button className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={!releaseId || busy || record.phase !== 'H'} onClick={async () => {setBusy(true);setError('');try {const result=await researchRequest<Job>('/inference',{body:{episode_id:id,tick,release_id:releaseId},key:crypto.randomUUID()});setJob(result);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Run greedy inference</button></div>}
        {job?.kind === 'INFER' && <Link className="mt-3 block text-sm text-chartwell-blue underline" href={`/research/jobs?job=${job.id}`}>Follow inference job →</Link>}
      </section>
    </>}
  </ResearchShell>;
}

export function StateView({ record, boundary = 'after' }: { record: TickRecord; boundary?: 'before' | 'after' }) {
  const state = record[boundary];
  return <section className="grid gap-4 lg:grid-cols-[2fr_1fr]"><div className="rounded border bg-white p-5"><h2 className="font-semibold">State {boundary === 'after' ? 'after interval' : 'before action'} · boundary {state.tick}</h2><div className="mt-4 grid gap-4 md:grid-cols-3">{state.components.map((components,m) => {
    const job = state.jobs.find(j => j?.machine === m); const mode = job ? 'Service' : components.some(c => c.failed) ? 'Breakdown' : 'Working';
    return <article key={m} className="rounded border border-stone-border p-3"><div className="flex justify-between gap-2 text-sm"><strong>M{m+1}</strong><span className={mode === 'Breakdown' ? 'text-red-800' : mode === 'Service' ? 'text-chartwell-blue' : 'text-teal-800'}>{mode}</span></div><ul className="mt-3 space-y-2 text-xs">{components.map((c,i) => <li key={i}>C{i+1}: age {c.age} · {c.failed ? 'FAILED' : 'healthy'}</li>)}</ul></article>;
  })}</div></div><div className="rounded border bg-white p-5"><h2 className="font-semibold">Technician commitments</h2><ul className="mt-4 space-y-4 text-sm">{state.jobs.map((j,i) => <li key={i}><strong>T{i+1}</strong> · {j ? `${j.kind} M${j.machine+1}/C${j.component+1} · ${j.remaining} ticks remaining` : 'Idle'}</li>)}</ul></div></section>;
}
