"use client";
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BookOpen, FileCheck2, GitCompareArrows, Plus } from 'lucide-react';
import { researchApi } from '@/lib/research-api/client';
import { useResource } from '@/lib/research-api/use-resource';
import { ResearchShell, EvidenceBadge } from './research-shell';
import { AsyncState } from './async-state';

export function ResearchOverview() {
  const { data, error, reload } = useResource('campaigns', researchApi.campaigns);
  return <ResearchShell title="Research workspace" description="Explore versioned experiments, compare coordination policies and inspect the evidence behind each result.">
    <section aria-labelledby="campaign-register-title">
      <div className="research-section-heading"><div className="flex items-center gap-3"><h2 id="campaign-register-title">Campaigns</h2>{data && <EvidenceBadge>{data.length}</EvidenceBadge>}</div><Link href="/research/import" className="research-primary"><Plus size={15} aria-hidden="true" />Import evidence</Link></div>
      {error ? <AsyncState kind="error" description={error} onRetry={reload} /> : !data ? <AsyncState kind="loading" /> : !data.length ? <AsyncState kind="empty" title="No campaigns imported" description="Import a research bundle or a clearly labelled engineering episode to begin." /> :
        <div className="campaign-register"><div className="campaign-register-head" aria-hidden="true"><span>Campaign / objective</span><span>Study runs</span><span>Open</span></div>{data.map(c => <article key={c.id} className="campaign-row"><div><p className="campaign-key">{c.campaignKey}</p><Link className="campaign-title" href={`/research/campaigns/${c.id}`}>{c.title}<ArrowUpRight size={16} aria-hidden="true" /></Link><p className="campaign-objective">{c.objective}</p></div><span className="campaign-run-count">{c._count?.runs ?? c.runs?.length ?? 0}<span>study runs</span></span><Link className="campaign-open" aria-label={`Open ${c.title}`} href={`/research/campaigns/${c.id}`}><ArrowRight size={18} aria-hidden="true" /></Link></article>)}</div>}
    </section>
    <section className="research-guide" aria-labelledby="research-guide-title"><div className="research-section-heading"><h2 id="research-guide-title">A workspace built around evidence</h2><span className="text-xs text-ash-gray">JCST/1.1</span></div><div className="research-guide-grid">
      <div><BookOpen size={18} aria-hidden="true" /><h3>One physical contract</h3><p>Service timing, component choice and technician assignment. Every decision is a complete matching or WAIT.</p></div>
      <div><GitCompareArrows size={18} aria-hidden="true" /><h3>Controlled comparisons</h3><p>Centralized PPO S / A / F and reference controls, with cases, training roots and sample budgets kept visible.</p></div>
      <div><FileCheck2 size={18} aria-hidden="true" /><h3>Evidence with scope</h3><p>Artifact integrity, local physical replay and source-reported statistics retain their distinct verification scope.</p></div>
    </div></section>
  </ResearchShell>;
}
