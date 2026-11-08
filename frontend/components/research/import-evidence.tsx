"use client";
import { useRef, useState } from 'react';
import Link from 'next/link';
import { researchRequest, type Job } from '@/lib/research-api/client';
import { ResearchShell } from './research-shell';

export function ImportEvidence() {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [job, setJob] = useState<Job>(); const [busy, setBusy] = useState(false);
  const identity = useRef<{ text: string; key: string } | null>(null);
  async function submit() {
    setError(''); setBusy(true);
    try {
      const bundle = JSON.parse(text);
      if (!identity.current || identity.current.text !== text) identity.current = { text, key: crypto.randomUUID() };
      setJob(await researchRequest<Job>('/imports', { body: { bundle }, key: identity.current.key }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <ResearchShell title="Import evidence" description="Register a bounded immutable JCST bundle. Import validates hashes and independently replays included physical traces; statistical reports retain their source-reported scope.">
    <section className="space-y-4 rounded-lg border bg-white p-5"><label className="block text-sm font-semibold">Bundle JSON file<input type="file" accept="application/json,.json" className="mt-2 block" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 8_000_000) { setError('Bundle exceeds 8 MB. Export a bounded trace subset.'); return; }
      setText(await file.text()); setJob(undefined); setError('');
    }} /></label><label className="block text-sm font-semibold">Or paste bundle JSON<textarea className="mt-2 block min-h-64 w-full rounded border p-3 font-mono text-xs" value={text} onChange={e => { setText(e.target.value); setJob(undefined); }} /></label>
    <button className="rounded bg-slate-text px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !text.trim()} onClick={submit}>{busy ? 'Submitting…' : 'Queue validated import'}</button>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{job && <p role="status" className="text-sm">Import {job.status.toLowerCase()}. <Link className="text-chartwell-blue underline" href={`/research/jobs?job=${job.id}`}>Follow job and validation</Link></p>}</section>
  </ResearchShell>;
}
