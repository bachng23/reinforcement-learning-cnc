"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarRange, Factory, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { OperationsPanel, OperationsStatus } from "@/components/operations/operations-shell";
import { MachineInspector } from "@/components/operations/machine-inspector";
import { CreateDecisionCase } from "@/components/operations/create-decision-case";
import { AsyncState } from "@/components/research/async-state";
import { getOperationsFactoryId, useOperationsContext, useOperationsOverview, type OperationsApiClient, type OperationsApiMode, type OperationsOverview } from "@/lib/operations-api";
import { machineStatuses } from "@/lib/operations-api/overview";
import { operationsHref, operationsUiClient } from "@/lib/operations-ui";
import { formatDateTime } from "@/lib/operations/format";
import { OperationsApiError } from "@/lib/operations-api/client";

function SummaryCard({ label, children, note, href }: { label: string; children: ReactNode; note: string; href?: string }) {
  const content = <><div className="flex items-start justify-between gap-3"><h2 className="text-xs font-medium text-slate-500">{label}</h2>{href ? <ArrowUpRight className="h-4 w-4 text-blue-600" /> : null}</div><div className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{children}</div><p className="mt-2 text-xs leading-5 text-slate-500">{note}</p></>;
  const style = "min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
  return href ? <Link href={href} aria-label={label} className={`${style} transition hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{content}</Link> : <article className={style}>{content}</article>;
}

function FactoryInvestigation({ api, overview, mode, onRefresh }: { api: OperationsApiClient; overview: OperationsOverview; mode: OperationsApiMode; onRefresh: () => void }) {
  const { state, retry } = useOperationsContext({ api, factoryId: overview.context.factory_id });
  const refresh = () => { retry(); onRefresh(); };
  const ready = state.kind === "ready" ? state.data : null;
  const snapshot = ready?.snapshotResponse;
  const headRevision = snapshot && "head_revision" in snapshot ? snapshot.head_revision : undefined;
  const mismatch = ready && (snapshot!.factory_id !== overview.context.factory_id || snapshot!.snapshot.factory_id !== overview.context.factory_id
    || snapshot!.snapshot_id !== overview.context.snapshot_id || snapshot!.snapshot.snapshot_id !== overview.context.snapshot_id
    || snapshot!.plan_version !== overview.context.plan_version || ready.scheduleResponse.factory_id !== overview.context.factory_id
    || (headRevision !== undefined && headRevision !== overview.context.head_revision));
  return <section id="factory-investigation" aria-label="Factory investigation" className="scroll-mt-20 space-y-5">
    {state.kind === "loading" ? <AsyncState compact kind="loading" title="Loading factory investigation context" description="Reading the current snapshot and schedule. Summary values remain at their own read timestamp." /> : null}
    {state.kind !== "loading" && state.kind !== "ready" ? <AsyncState compact kind="error" title="Investigation context unavailable" description={state.message} onRetry={refresh} /> : null}
    {mismatch ? <AsyncState kind="error" title="Observation context changed" description="The summary and resource reads do not refer to the same factory/snapshot/plan. Measurements and create controls are hidden. Refresh both reads before continuing." onRetry={refresh} retryLabel="Refresh factory context" /> : null}
    {ready && !mismatch ? <><MachineInspector snapshot={ready.snapshotResponse.snapshot} demo={mode === "mock"} /><CreateDecisionCase api={api} data={ready} mode={mode} onRefresh={refresh} /></> : null}
  </section>;
}

function OverviewContent({ data, api, mode, onRefresh }: { data: OperationsOverview; api: OperationsApiClient; mode: OperationsApiMode; onRefresh: () => void }) {
  const { context, cases, machines, provenance, review_preview: preview } = data;
  const href = (path: string, options: { status?: string; mode?: string } = {}) => operationsHref(path, context.factory_id, { demo: mode === "mock", ...options });
  return <>
    <section aria-label="Factory read context" className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 text-xs md:grid-cols-2 xl:grid-cols-4">
      <div className="min-w-0"><p className="text-slate-500">Factory / observation</p><p className="mt-1 break-all font-mono font-semibold">{context.factory_id}</p><p className="mt-1 break-all font-mono text-slate-500">{context.snapshot_id}</p></div>
      <div><p className="text-slate-500">Snapshot captured</p><time dateTime={context.captured_at} className="mt-1 block font-medium">{formatDateTime(context.captured_at)}</time><p className="mt-1 text-slate-500">Observation time, not polling freshness</p></div>
      <div><p className="text-slate-500">Summary read</p><time dateTime={context.read_at} className="mt-1 block font-medium">{formatDateTime(context.read_at)}</time><p className="mt-1 text-slate-500">One consistent server read snapshot</p></div>
      <div><p className="text-slate-500">Source coverage</p><p className="mt-1 font-medium">{provenance.machines.covered} / {provenance.machines.population} returned machines</p><p className="mt-1 text-slate-500">{provenance.machines.source} · head revision {context.head_revision}</p></div>
    </section>
    <section aria-label="Authoritative factory summary" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Machines in snapshot" note="Validated current snapshot coverage, not a health or utilization KPI." href="#factory-investigation">{machines.total}</SummaryCard>
      <SummaryCard label="LIVE cases awaiting approval" note="Includes stale cases. Review context before acting." href={href("/operations/cases", { status: "AWAITING_APPROVAL", mode: "LIVE" })}>{cases.LIVE.by_status.AWAITING_APPROVAL}</SummaryCard>
      <SummaryCard label="LIVE approved, not published" note="Approval does not publish. Commit is a separate reviewed action." href={href("/operations/cases", { status: "APPROVED", mode: "LIVE" })}>{cases.LIVE.by_status.APPROVED}</SummaryCard>
      <SummaryCard label="LIVE cases being processed" note="Backend processing buckets, not active agents. No equivalent processing filter is available in the list API."><div className="flex gap-5 text-2xl"><span>{cases.LIVE.by_processing.PENDING}<small className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Pending</small></span><span>{cases.LIVE.by_processing.RUNNING}<small className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Running</small></span></div></SummaryCard>
    </section>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(270px,1fr)]">
      <OperationsPanel title="Decisions requiring review" description="LIVE / AWAITING_APPROVAL · newest created first, as returned by the backend. This preview is not the total count.">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 text-xs text-slate-500"><span>Authoritative at {formatDateTime(context.read_at)} · includes stale records</span><Link className="font-semibold text-blue-700 underline underline-offset-4" href={href("/operations/cases", preview.filters)}>View all awaiting approval</Link></div>
        {preview.items.length ? <div className="max-h-[460px] overflow-auto" role="region" aria-label="Review preview" tabIndex={0}><table className="w-full min-w-[650px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500"><tr><th className="p-4 font-medium">Case / context</th><th className="p-4 text-center font-medium">Status</th><th className="p-4 font-medium">Created / basis</th><th className="p-4 font-medium">Review</th></tr></thead><tbody className="divide-y divide-slate-100">{preview.items.map(item => <tr key={item.decision_case_id}><td className="max-w-[240px] p-4"><p className="break-all font-mono text-xs font-medium">{item.decision_case_id}</p><p className={`mt-2 text-xs ${item.stale ? "text-amber-800" : "text-slate-500"}`}>{item.stale ? "Stale basis — review required" : "Current basis"}</p></td><td className="p-4 text-center"><OperationsStatus value={item.status} /></td><td className="max-w-[240px] p-4 text-xs text-slate-500"><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time><p className="mt-2 break-all font-mono">{item.snapshot_id}</p><p className="mt-1">Basis plan {item.base_plan_version} · current head {item.current_context.plan_version}</p></td><td className="p-4"><Link className="dss-secondary" href={operationsHref("/operations/recommendations", item.factory_id, { caseId: item.decision_case_id, demo: mode === "mock" })} aria-label={`Review case ${item.decision_case_id}`}>Review case</Link></td></tr>)}</tbody></table></div> : <div className="p-8 text-center"><p className="text-sm font-medium">No LIVE cases awaiting approval</p><p className="mt-2 text-xs text-slate-500">Other lifecycle states and SIMULATION_ONLY cases remain available in Decision Center.</p><Link href={href("/operations/cases")} className="dss-secondary mt-4">Browse decision cases</Link></div>}
        {preview.has_more ? <p className="border-t p-4 text-xs text-slate-500">More matches exist. Open the scoped list for cursor pagination.</p> : null}
      </OperationsPanel>
      <OperationsPanel title="Machine status distribution" description="Backend status buckets from the validated observation, not health thresholds."><dl className="divide-y divide-slate-100 px-5">{machineStatuses.map(status => <div className="flex items-center justify-between gap-3 py-3" key={status}><dt><OperationsStatus value={status} /></dt><dd className="font-mono text-lg font-semibold tabular-nums">{machines.by_status[status]}</dd></div>)}</dl><p className="border-t p-4 text-xs leading-5 text-slate-500">Missing measurements remain unknown. UNAVAILABLE is not counted as healthy. No sensor history or utilization aggregate is provided.</p></OperationsPanel>
    </div>
    <section aria-label="Published factory plan" className="flex flex-col justify-between gap-5 rounded-xl border border-slate-200 bg-white p-5 lg:flex-row lg:items-center"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-slate-500">Published plan</p><h2 className="mt-2 text-xl font-semibold">{context.publication ? `Head plan version ${context.plan_version}` : "No published schedule"}</h2>{context.publication ? <p className="mt-2 break-all text-xs text-slate-500">{context.publication.schedule_id} · revision {context.publication.schedule_revision}<br />Immutable basis: {context.publication.basis_snapshot_id}. Observation: {context.snapshot_id}.</p> : <p className="mt-2 text-xs text-slate-500">The API returned publication=null. This is not an error or an empty sensor measurement.</p>}</div><div className="flex shrink-0 flex-wrap gap-2"><Link href={href("/operations/schedule")} className="dss-primary"><CalendarRange className="h-4 w-4" />Open integrated schedule</Link><Link href={href("/operations")} className="dss-secondary">Factory resources</Link></div></section>
    <FactoryInvestigation key={`${context.factory_id}:${context.snapshot_id}:${context.plan_version}:${context.read_at}`} api={api} overview={data} mode={mode} onRefresh={onRefresh} />
    <p className="text-xs leading-5 text-slate-500">LIVE cards cover all persisted factory LIVE cases at the displayed read time, including stale/terminal records. SIMULATION_ONLY total: <Link className="text-blue-700 underline" href={href("/operations/cases", { mode: "SIMULATION_ONLY" })}>{cases.SIMULATION_ONLY.total}</Link>. Processing and lifecycle dimensions overlap and must not be added together.</p>
  </>;
}

export function DashboardPage({ api, factoryId, apiMode = "real" }: { api?: OperationsApiClient; factoryId?: string; apiMode?: OperationsApiMode } = {}) {
  const router = useRouter();
  const factory = factoryId ?? getOperationsFactoryId();
  const [draftFactory, setDraftFactory] = useState(factory);
  const client = useMemo(() => api ?? operationsUiClient(apiMode), [api, apiMode]);
  const [diagnostic, setDiagnostic] = useState<{ factoryId: string; reference: string } | null>(null);
  // Observe the same client read for transport diagnostics only. The Flex hook
  // still owns all reads, cancellation, validation, state and authoritative DTOs.
  const summaryClient = useMemo(() => ({
    getOperationsOverview: (async (factoryId, options) => {
      setDiagnostic(null);
      try { return await client.getOperationsOverview(factoryId, options); }
      catch (error: unknown) {
        if (!options?.signal?.aborted && error instanceof OperationsApiError) {
          const payload = error.payload;
          const reference = error.contractError?.correlation_id ?? (payload && typeof payload === "object" && "request_id" in payload && typeof payload.request_id === "string" ? payload.request_id : undefined);
          if (reference) setDiagnostic({ factoryId, reference });
        }
        throw error;
      }
    }) satisfies OperationsApiClient["getOperationsOverview"],
  }), [client]);
  const { state, refresh, retry } = useOperationsOverview({ api: summaryClient, factoryId: factory });
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ factoryId: string }>).detail?.factoryId === factory) refresh(); };
    window.addEventListener("operations-context-changed", changed);
    return () => window.removeEventListener("operations-context-changed", changed);
  }, [factory, refresh]);
  return <AppShell title="Operations Overview" factoryId={factory} demo={apiMode === "mock"}><main className="mx-auto w-full max-w-[1600px] min-w-0 space-y-6 px-4 py-7 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Production decision support</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Factory Overview</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Understand the factory, review pending decisions, and inspect the evidence before acting.</p></div><div className="flex flex-wrap gap-2"><Link href={operationsHref("/operations/cases", factory, { demo: apiMode === "mock" })} className="dss-secondary">Decision Center</Link><button className="dss-primary" type="button" disabled={state.kind === "loading"} onClick={refresh}><RefreshCw className={`h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />Refresh overview</button></div></header>
    <div role="note" className={`rounded-lg border px-4 py-3 text-sm ${apiMode === "real" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{apiMode === "real" ? "Live Operations API · authoritative summary and immutable observation · no fixture fallback." : "DEMO / PREVIEW · explicit demo mode. Cases, counts and machine IDs are isolated from production; no backend writes occur."}</div>
    <form onSubmit={event => { event.preventDefault(); if (draftFactory.trim()) router.push(operationsHref("/overview", draftFactory.trim(), { demo: apiMode === "mock" })); }} className="flex flex-wrap items-end gap-3"><label className="min-w-[220px] max-w-sm flex-1 text-xs font-medium text-slate-600">Factory ID<input className="dss-input mt-1" required maxLength={128} value={draftFactory} onChange={event => setDraftFactory(event.target.value)} /></label><button type="submit" className="dss-secondary"><Factory className="h-4 w-4" />Open factory</button><Link className="ml-auto py-2 text-xs text-slate-500 underline" href={apiMode === "real" ? operationsHref("/overview", "factory-demo-01", { demo: true }) : operationsHref("/overview", getOperationsFactoryId())}>{apiMode === "real" ? "Open explicitly labelled demo" : "Return to production"}</Link></form>
    {state.kind === "loading" ? <AsyncState kind="loading" title="Loading factory overview" description="Reading the authoritative summary. Counts are not inferred from case-list pages." /> : null}
    {state.kind === "missing-factory" ? <AsyncState kind="empty" title="Factory ID required" description="Choose the factory you are authorized to inspect." /> : null}
    {"message" in state ? <AsyncState kind="error" title={state.kind === "unauthorized" || state.kind === "forbidden" ? "Factory access required" : state.kind === "not-found" ? "Factory context unavailable" : "Factory overview could not be loaded"} description={state.message} onRetry={retry} action={state.kind === "unauthorized" ? <Link href="/login" className="dss-secondary">Sign in</Link> : undefined} /> : null}
    {"message" in state && diagnostic?.factoryId === factory ? <p className="break-all text-xs text-slate-500">Request reference: <code>{diagnostic.reference}</code></p> : null}
    {state.kind === "ready" ? <OverviewContent data={state.data} api={client} mode={apiMode} onRefresh={refresh} /> : null}
  </main></AppShell>;
}
