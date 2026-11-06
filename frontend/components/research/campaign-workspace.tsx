"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { endpoint } from '@/lib/auth';
import { researchApi, type Run } from '@/lib/research-api/client';
import { useResource } from '@/lib/research-api/use-resource';
import { ResearchShell, EvidenceBadge } from './research-shell';
import { AsyncState } from './async-state';
import { LearningCurve } from './learning-curve';

export function CampaignWorkspace({ id }: { id: string }) {
  const resource = useResource(`campaign:${id}`, signal => researchApi.campaign(id, signal));
  const query = useSearchParams();
  const [axis, setAxis] = useState<'samples' | 'time'>('samples');
  const campaign = resource.data;
  const run = campaign?.runs.find(r => r.id === query.get('run')) ?? campaign?.runs[0];
  const cases = [...new Set(run?.metadataJson.curves.map(p => p.case_id) ?? [])];
  const caseId = cases.includes(query.get('case') || '') ? query.get('case')! : cases[0];
  const allPoints = run?.metadataJson.curves ?? [];
  const arms = [...new Set(allPoints.map(p => p.arm))].sort();
  const roots = [...new Set(allPoints.map(p => p.training_root))].sort((a,b) => Number(a)-Number(b));
  const budgets = [...new Set(allPoints.map(p => p.samples))].sort((a,b) => a-b);
  const arm = arms.includes(query.get('arm') || '') ? query.get('arm')! : 'all';
  const root = roots.includes(query.get('root') || '') ? query.get('root')! : 'all';
  const budget = budgets.includes(Number(query.get('budget'))) ? Number(query.get('budget')) : Infinity;
  const selectedPoints = allPoints.filter(p => p.case_id === caseId && (arm === 'all' || p.arm === arm) && (root === 'all' || p.training_root === root) && p.samples <= budget);
  // These filters only inspect already-loaded data. Native history updates are
  // synchronous and integrated with useSearchParams, so rapid selections do not
  // overwrite each other with an older, in-flight router navigation.
  const select = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set(key, value);
    window.history.replaceState(null, '', `?${next}`);
  };
  return <ResearchShell title={campaign?.title || 'Campaign evidence'} description={campaign?.objective || 'Loading the immutable campaign and its study runs.'}>
    {resource.error ? <AsyncState kind="error" description={resource.error} onRetry={resource.reload} /> : !campaign ? <AsyncState kind="loading" /> : !run ? <AsyncState kind="empty" /> : <>
      <div className="flex flex-wrap items-end gap-5"><label className="text-sm">Study / run<select className="ml-3 rounded border p-2" value={run.id} onChange={e => select('run', e.target.value)}>{campaign.runs.map(r => <option key={r.id} value={r.id}>{r.studyKey} / {r.runKey}</option>)}</select></label><EvidenceBadge>{run.origin === 'engineering' ? 'Engineering evidence' : 'Research evidence'}</EvidenceBadge><EvidenceBadge>JCST/1.1</EvidenceBadge></div>
      <Evidence run={run} />
      {!!allPoints.length && <div className="research-filter-bar">{!!cases.length && <><label className="text-sm">Case<select aria-label="Case" className="ml-3 rounded border p-2" value={caseId} onChange={e => select('case', e.target.value)}>{cases.map(c => <option key={c}>{c}</option>)}</select></label><label className="text-sm">Horizontal axis<select className="ml-3 rounded border p-2" value={axis} onChange={e => setAxis(e.target.value as typeof axis)}><option value="samples">Simulator decisions</option><option value="time">Measured training seconds</option></select></label></>}
      {!!allPoints.length && <><label>Arm<select className="ml-3 rounded border p-2" value={arm} onChange={e=>select('arm',e.target.value)}><option value="all">All arms</option>{arms.map(a=><option key={a}>{a}</option>)}</select></label><label>Training root<select className="ml-3 rounded border p-2" value={root} onChange={e=>select('root',e.target.value)}><option value="all">All roots</option>{roots.map(r=><option key={r}>{r}</option>)}</select></label><label>Show through decisions<select className="ml-3 rounded border p-2" value={Number.isFinite(budget)?String(budget):'all'} onChange={e=>select('budget',e.target.value)}><option value="all">Full window</option>{budgets.map(b=><option key={b} value={b}>{b.toLocaleString()}</option>)}</select></label></>}</div>}
      {!!allPoints.length && <LearningCurve points={selectedPoints} axis={axis} />}
      {!!allPoints.length && <p className="text-xs text-ash-gray">Curve filters select {selectedPoints.length} checkpoint rows for inspection. Primary contrasts below retain the full predeclared study panel and window.</p>}
      {!!run.metadataJson.contrasts.length && <section className="research-table-panel overflow-x-auto"><h2 className="mb-3 font-semibold">Predeclared contrasts · lower cost is better</h2><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Case / contrast</th><th>Estimand</th><th>Difference</th><th>Adjusted interval</th><th>Source gate</th></tr></thead><tbody>{run.metadataJson.contrasts.filter(c => !caseId || c.case_id === caseId).map((c,i) => <tr key={i} className="border-b"><td className="p-3">{c.case_id} / {c.contrast}</td><td className="max-w-xs p-2">{c.estimand}<p className="mt-1 text-xs text-ash-gray">{c.interval_method}</p></td><td>{c.difference.toFixed(2)}</td><td>[{Number(c.interval[0]).toFixed(2)}, {Number(c.interval[1]).toFixed(2)}]</td><td><EvidenceBadge>{c.gate}</EvidenceBadge></td></tr>)}</tbody></table></section>}
      <section className="rounded-lg border border-stone-border bg-white p-5"><h2 className="font-semibold">Claims and limits</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{run.metadataJson.claims.map((c,i) => <li key={i}>{c}</li>)}</ul><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ash-gray">{run.metadataJson.limitations.map((c,i) => <li key={i}>{c}</li>)}</ul></section>
      <details className="rounded border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">Per-root checkpoints ({run.metadataJson.curves.length})</summary><div className="mt-3 max-h-96 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Case</th><th>Arm/root</th><th>Decisions</th><th>Mode</th><th>H cost</th><th>Tail cost</th><th>Total cost</th><th>Training s</th></tr></thead><tbody>{selectedPoints.map((p,i) => <tr key={i} className="border-t"><td className="py-2">{p.case_id}</td><td>{p.arm}/{p.training_root}</td><td>{p.samples}</td><td>{p.mode}</td><td>{p.mean_h_cost?.toFixed(2) ?? 'Unavailable'}</td><td>{p.mean_tail_cost?.toFixed(2) ?? 'Unavailable'}</td><td>{p.mean_total_cost.toFixed(2)}</td><td>{p.training_seconds?.toFixed(2) ?? 'Unavailable'}</td></tr>)}</tbody></table></div></details>
      <section><h2 className="mb-3 font-semibold">Included episode traces</h2>{!run.episodes.length ? <p className="text-sm text-ash-gray">No traces in this bundle. Replay is unavailable; results remain readable.</p> : <div className="divide-y rounded border bg-white">{run.episodes.map(e => <Link key={e.id} className="flex flex-wrap justify-between gap-3 p-4 text-sm hover:bg-hover-stone" href={`/research/episodes/${e.id}`}><span className="font-semibold text-slate-text">{e.caseId} / {e.controller} · seed {e.physicalSeed}</span><span>H {e.controlledCost} + tail {e.tailCost} = {e.totalCost}</span><span>Replay →</span></Link>)}</div>}</section>
    </>}
  </ResearchShell>;
}

function Evidence({ run }: { run: Run }) {
  const p = run.metadataJson.provenance;
  return <section className="research-evidence-strip"><h2 className="font-semibold">Evidence and provenance</h2><div className="mt-3 flex flex-wrap gap-3"><EvidenceBadge>Bundle hash verified</EvidenceBadge><EvidenceBadge>{run.physicalReplayJson.length ? `Local physical replay PASS · ${run.physicalReplayJson.length} included traces` : 'Local physical replay unavailable'}</EvidenceBadge><EvidenceBadge>Statistics: source reports only</EvidenceBadge></div>
    <details className="mt-3 text-xs"><summary className="cursor-pointer">Source versions and original artifacts</summary><ul className="mt-3 space-y-2 text-xs">{run.metadataJson.source_audits.map((a,i) => <li key={i}>Source {a.kind} audit: {a.status} · {a.scope}</li>)}</ul><dl className="mt-3 grid gap-2 break-all"><dt>Source commit</dt><dd><a className="text-chartwell-blue underline" href={`${p.repository}/tree/${p.commit}`} target="_blank" rel="noreferrer">{p.commit}</a></dd><dt>Protocol</dt><dd>{p.protocol_id} · {p.protocol_hash}</dd><dt>Source manifest hash</dt><dd>{p.source_hash}</dd><dt>Bundle hash</dt><dd>{run.bundleHash}</dd></dl><div className="mt-4 flex flex-col gap-2">{run.artifacts.map(a => <a className="text-chartwell-blue underline" key={a.id} href={endpoint(`/api/v1/research/artifacts/${a.id}`)} target="_blank" rel="noreferrer">{a.artifactKey} · {a.byteLength.toLocaleString()} bytes · {a.contentHash.slice(0,12)}</a>)}</div></details>
  </section>;
}
