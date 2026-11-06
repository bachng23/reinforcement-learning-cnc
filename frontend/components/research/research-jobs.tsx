"use client";
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { canonicalHash, researchApi, researchRequest, type Job } from '@/lib/research-api/client';
import { useResource } from '@/lib/research-api/use-resource';
import { ResearchShell, EvidenceBadge } from './research-shell';
import { AsyncState } from './async-state';
import { StateView } from './episode-replay';
import type { Episode } from '@/types/generated/jcst';

export function ResearchJobs() {
  const query = useSearchParams(); const selected = query.get('job');
  const resource = useResource(`jobs:${selected || 'all'}`, signal => selected ? researchApi.job(selected, signal).then(j => [j]) : researchApi.jobs(signal));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const pending = resource.data?.some(j => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => { if (!pending) return; const timer = setTimeout(resource.reload, 1500); return () => clearTimeout(timer); }, [pending, resource.data, resource.reload]);
  const keys = useRef(new Map<string,string>());
  async function command(job: Job, action: 'cancel' | 'retry') {
    setError(''); setBusy(true);
    const identity = `${job.id}/${action}`;
    if (!keys.current.has(identity)) keys.current.set(identity, crypto.randomUUID());
    try { const next = await researchRequest<Job>(`/jobs/${job.id}/${action}`, { body: {}, key: keys.current.get(identity) });
      if (action === 'retry') window.location.assign(`/research/jobs?job=${next.id}`); else resource.reload();
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <ResearchShell title="Jobs and simulation reviews" description="Imports, controller inference and copied-state simulations run separately from the web request. Failed and cancelled attempts remain recorded.">
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {resource.error ? <AsyncState kind="error" description={resource.error} onRetry={resource.reload} /> : !resource.data ? <AsyncState kind="loading" /> : !resource.data.length ? <AsyncState kind="empty" title="No research jobs" /> : <div className="space-y-5">{resource.data.map(job => <article key={job.id} className="space-y-4 rounded border bg-white p-5"><header className="flex flex-wrap justify-between gap-3"><Link className="font-semibold text-slate-text" href={`/research/jobs?job=${job.id}`}>{job.kind} · {job.id.slice(0,8)}</Link><EvidenceBadge>{job.status}</EvidenceBadge></header>
      {job.errorCode && <p className="text-sm text-red-800">{job.errorCode}</p>}
      {job.outputJson?.campaignId && <Link className="text-sm text-chartwell-blue underline" href={`/research/campaigns/${job.outputJson.campaignId}`}>Open imported campaign →</Link>}
      {job.kind === 'BRANCH' && job.outputJson && <><div className="grid gap-4 text-sm md:grid-cols-3"><p>Baseline cost <strong>{job.outputJson.baselineTotalCost}</strong></p><p>Branch cost <strong>{job.outputJson.branchTotalCost}</strong></p><p>Branch − baseline <strong>{job.outputJson.deltaTotalCost}</strong></p></div><p className="text-xs text-ash-gray">{job.outputJson.note}</p><p className="text-sm">Override at tick {job.inputJson.tick}: {JSON.stringify(job.inputJson.action)} · continuation {job.inputJson.controller} · reason: {job.inputJson.reason}</p><BranchTrace id={job.id} /><BranchReview job={job} reload={resource.reload} /></>}
      {job.kind === 'INFER' && job.outputJson && <p className="text-sm">{job.outputJson.arm} · matching {JSON.stringify(job.outputJson.action)} · checkpoint {job.outputJson.checkpoint_sha256?.slice(0,16)}</p>}
      {(job.status === 'RUNNING' || job.status === 'QUEUED') && <button disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={() => command(job, 'cancel')}>Cancel job</button>}
      {(job.status === 'FAILED' || job.status === 'CANCELLED') && <button disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={() => command(job, 'retry')}>Retry as a new attempt</button>}
    </article>)}</div>}
  </ResearchShell>;
}

function BranchTrace({id}:{id:string}) {
  const [open,setOpen]=useState(false);
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Replay this simulation branch</summary>{open && <LoadedBranchTrace id={id} />}</details>;
}
function LoadedBranchTrace({id}:{id:string}) {
  const [variant,setVariant]=useState('branch');
  const resource=useResource(`branch:${id}:${variant}`,signal=>researchRequest<Episode>(`/jobs/${id}/episode?variant=${variant}`,{signal}));
  const [tick,setTick]=useState(0);
  if(resource.error)return <AsyncState kind="error" description={resource.error} onRetry={resource.reload} />;
  if(!resource.data)return <AsyncState kind="loading" />;
  return <div className="mt-4 space-y-4"><label className="block text-sm">Trajectory<select className="ml-3 rounded border p-2" value={variant} onChange={e=>setVariant(e.target.value)}><option value="branch">Override</option><option value="baseline">Matched continuation baseline</option></select></label><label className="block text-sm">Branch tick {tick}<input type="range" aria-label="Branch tick" min={0} max={resource.data.records.length-1} value={tick} onChange={e=>setTick(Number(e.target.value))} className="mt-2 block w-full" /></label><StateView record={resource.data.records[tick]} /></div>;
}

function BranchReview({ job, reload }: { job: Job; reload: () => void }) {
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function review(decision: 'ACCEPT' | 'REJECT') {
    setBusy(true); setError('');
    try { await researchRequest(`/jobs/${job.id}/review`, { body: { decision, reason, expected_output_hash: await canonicalHash(job.outputJson) } }); reload(); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (job.reviews?.length) return <p className="text-sm">Simulation review: <strong>{job.reviews[0].decision}</strong> · {job.reviews[0].reason}</p>;
  return <div className="border-t pt-4"><p className="text-sm">Record a management review of this simulation. This does not execute maintenance or publish an operational schedule.</p><label className="mt-3 block text-sm">Review reason<textarea className="mt-2 block w-full rounded border p-2" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label><div className="mt-3 flex gap-3"><button className="rounded border px-3 py-2 text-sm" disabled={busy || !reason.trim()} onClick={() => review('ACCEPT')}>Accept simulation result</button><button className="rounded border px-3 py-2 text-sm" disabled={busy || !reason.trim()} onClick={() => review('REJECT')}>Reject simulation result</button></div>{error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}</div>;
}
