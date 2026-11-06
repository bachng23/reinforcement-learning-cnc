"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { AsyncState } from "@/components/research/async-state";
import { getOperationsApiClient, getOperationsApiMode, getOperationsFactoryId, type OperationsApiClient, type OperationsApiMode } from "@/lib/operations-api";
import { DECISION_CASE_STATUSES, isDecisionCaseStatus, type DecisionCaseListItem, type DecisionCaseListQuery } from "@/lib/operations-api/decision-case-reads";
import { useDecisionCases } from "@/lib/operations-api/use-decision-cases";
import { formatDateTime } from "@/lib/operations/format";
import { operationsHref, operationsUiClient } from "@/lib/operations-ui";

const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 py-2 text-sm font-medium disabled:opacity-50";
const inputClass = "mt-1 min-h-10 w-full rounded-md border border-[var(--color-stone-border)] bg-white px-3 text-sm";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-[var(--color-ash-gray)]">{label}</dt><dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">{children}</dd></div>;
}

export function DecisionCaseRow({ item, demo = false }: { item: DecisionCaseListItem; demo?: boolean }) {
  return (
    <article aria-label={`Case ${item.decision_case_id}`} className="min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><p className="break-all font-mono text-sm font-semibold">{item.decision_case_id}</p><div className="mt-2 flex flex-wrap gap-2"><OperationsStatus value={item.status} /><OperationsStatus value={item.mode} /><span className={`rounded-full border px-2 py-1 text-xs ${item.stale ? "border-amber-200 bg-amber-50 text-amber-900" : "border-stone-200 text-stone-600"}`}>{item.stale ? "Stale basis" : "Current basis"}</span></div></div>
        <Link href={operationsHref("/operations/recommendations", item.factory_id, { caseId: item.decision_case_id, demo })} className={`${buttonClass} shrink-0`} aria-label={`Open recommendation for ${item.decision_case_id}`}>Open recommendation</Link>
      </div>
      <dl className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Factory">{item.factory_id}</Field>
        <Field label="Created"><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time></Field>
        <Field label="Updated"><time dateTime={item.updated_at}>{formatDateTime(item.updated_at)}</time></Field>
        <Field label="Case revision">{item.case_revision}</Field>
        <Field label="Basis snapshot / plan version"><span className="font-mono">{item.snapshot_id}</span><p>Plan version {item.base_plan_version}</p></Field>
        <Field label="Current head snapshot / plan version"><span className="font-mono">{item.current_context.snapshot_id}</span><p>Plan version {item.current_context.plan_version}</p></Field>
        <Field label="Human decision">{item.human_decision ? <><p>{item.human_decision.decision} by {item.human_decision.actor_id}</p><p>{formatDateTime(item.human_decision.decided_at)}</p><p>Candidate: {item.human_decision.candidate_plan_id ?? "Not provided"} · version {item.human_decision.candidate_version ?? "Not provided"}</p></> : "Not provided"}</Field>
        <Field label="Publication">{item.publication ? <><p className="font-mono">{item.publication.schedule_id}</p><p>Published plan version {item.publication.plan_version} · schedule revision {item.publication.schedule_revision}</p><p>Snapshot: {item.publication.snapshot_id}</p><p>By {item.publication.actor_id} · {formatDateTime(item.publication.committed_at)}</p></> : "Not published"}</Field>
      </dl>
      {item.error_code ? <p className="mt-4 break-all text-xs text-rose-700">Backend error code: <code>{item.error_code}</code></p> : null}
    </article>
  );
}

export function DecisionCasesPage({ api, apiMode, initialQuery }: {
  api?: OperationsApiClient; apiMode?: OperationsApiMode; initialQuery?: Omit<DecisionCaseListQuery, "cursor">;
} = {}) {
  const router = useRouter();
  const client = useMemo(() => api ?? (apiMode ? operationsUiClient(apiMode) : getOperationsApiClient()), [api, apiMode]);
  const mode = apiMode ?? getOperationsApiMode();
  // The keyed route remounts this page after searchParams commit. Keep reads
  // on that committed scope; a local query can race router.replace and reload.
  const query = initialQuery ?? { factory_id: getOperationsFactoryId(), limit: 25 };
  const [navigationPending, startNavigation] = useTransition();
  const [factory, setFactory] = useState(query.factory_id);
  const [status, setStatus] = useState(query.status ?? "");
  const [caseMode, setCaseMode] = useState(query.mode ?? "");
  const { state, refresh, retry, loadMore } = useDecisionCases({ api: client, query });
  function apply(event: FormEvent) {
    event.preventDefault();
    const next: Omit<DecisionCaseListQuery, "cursor"> = { factory_id: factory.trim(), limit: query.limit ?? 25,
      ...(isDecisionCaseStatus(status) ? { status } : {}),
      ...(caseMode === "LIVE" || caseMode === "SIMULATION_ONLY" ? { mode: caseMode } : {}) };
    const params = new URLSearchParams({ factory_id: next.factory_id });
    if (next.status) params.set("status", next.status);
    if (next.mode) params.set("mode", next.mode);
    if (mode === "mock") params.set("demo", "1");
    if (next.factory_id === query.factory_id && next.status === query.status && next.mode === query.mode) {
      refresh();
      return;
    }
    startNavigation(() => router.replace(`/operations/cases?${params}`, { scroll: false }));
  }
  const failed = !["loading", "ready", "missing-factory"].includes(state.kind);
  return (
    <OperationsShell title="Decision Cases" description="Find and reopen authoritative cases. Basis, head and publication versions remain distinct."
      factoryId={query.factory_id} demo={mode === "mock"}
      dataSource={mode === "real" ? "live" : "fixture"}
      dataSourceMessage={mode === "real" ? "Live Operations API. Factory authorization runs on every page; no fixture fallback. All actions on this page are read-only." : "Preview cases use the mock adapter and the same read DTOs. Create a preview case from Overview to populate this list."}
      actions={<button type="button" className={buttonClass} onClick={refresh} disabled={state.busy}><RefreshCw className={`h-4 w-4 ${state.busy ? "animate-spin" : ""}`} />Refresh cases</button>}>
      <OperationsPanel title="Case filters" description="Factory ID is required. Status and mode filters combine with AND. Changing filters starts a new cursor chain.">
        <form onSubmit={apply} className="grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_auto] sm:p-5">
          <label className="min-w-0 text-xs font-medium">Factory ID<input required maxLength={128} className={inputClass} value={factory} onChange={event => setFactory(event.target.value)} /></label>
          <label className="min-w-0 text-xs font-medium">Status<select className={inputClass} value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{DECISION_CASE_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="min-w-0 text-xs font-medium">Case mode<select className={inputClass} value={caseMode} onChange={event => setCaseMode(event.target.value)}><option value="">All modes</option><option value="LIVE">LIVE</option><option value="SIMULATION_ONLY">SIMULATION_ONLY</option></select></label>
          <button className={buttonClass} type="submit" disabled={navigationPending}>{navigationPending ? "Applying filters…" : "Apply filters"}</button>
        </form>
      </OperationsPanel>
      {state.kind === "loading" ? <AsyncState kind="loading" title="Loading decision cases" description={`Reading cases for ${query.factory_id}.`} /> : null}
      {state.kind === "missing-factory" ? <AsyncState kind="empty" title="Factory ID required" description="Enter the ID of a factory your account can access." /> : null}
      {failed ? <AsyncState kind="error" title={state.kind === "unauthorized" ? "Case access required" : state.kind === "invalid-cursor" ? "Pagination must restart" : "Cases could not be loaded"} description={state.message} onRetry={retry}
        action={state.kind === "unauthorized" ? <Link href="/login" className={buttonClass}>Sign in</Link> : undefined} /> : null}
      {state.items.length ? <section aria-label="Decision case results" className="min-w-0 space-y-3">
        <p role="status" className="text-sm text-[var(--color-ash-gray)]">{state.items.length} {state.items.length === 1 ? "case" : "cases"} loaded{failed ? " · previous pages; the latest read failed" : state.busy ? " · loading the next page" : ""}</p>
        {state.items.map(item => <DecisionCaseRow key={item.decision_case_id} item={item} demo={mode === "mock"} />)}
      </section> : null}
      {state.kind === "ready" && !state.items.length ? <AsyncState kind="empty" title="No matching cases" description="No cases match these factory, status and mode filters." action={<Link href={operationsHref("/overview", query.factory_id, { demo: mode === "mock" })} className={buttonClass}>Create a case from Overview</Link>} /> : null}
      {state.kind === "ready" && state.meta?.has_more ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--color-ash-gray)]">More cases are available. Cursor supplied by the backend.</p><button type="button" className={buttonClass} disabled={state.busy} onClick={loadMore}>{state.busy ? "Loading more cases…" : "Load more cases"}</button></div> : null}
      {state.kind === "ready" && state.items.length && !state.meta?.has_more ? <p className="text-xs text-[var(--color-ash-gray)]">End of results. Refresh to discover new cases or changed statuses.</p> : null}
    </OperationsShell>
  );
}
