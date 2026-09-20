"use client";

import { AlertTriangle, ChevronRight, ClipboardCheck, Filter, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { DECISION_STATUS_LABELS, DecisionStatusBadge } from "@/components/decisions/decision-detail";
import { AsyncState } from "@/components/research/async-state";
import { PageHeader } from "@/components/research/page-header";
import { getDecisionApiClient } from "@/lib/decision-api";
import { productApiErrorMessage } from "@/lib/product-api/errors";
import type { DecisionApiClient, DecisionQueueItem, DecisionStatus } from "@/types/decision";

function display(value: string | number | null | undefined): string {
  return value === undefined || value === null || value === "" ? "Not provided" : String(value);
}

export function decisionDetailHref(rowId: string): string {
  return `/decisions/${encodeURIComponent(rowId)}`;
}

export function DecisionCenterPage({ api }: { api?: DecisionApiClient } = {}) {
  const client = useMemo(() => api ?? getDecisionApiClient(), [api]);
  const [queue, setQueue] = useState<DecisionQueueItem[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [experimentFilter, setExperimentFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    setError("");
    void client.listQueue({ signal: controller.signal }).then((items) => {
      if (!controller.signal.aborted) setQueue(items);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(productApiErrorMessage(reason, "Decision queue could not be loaded."));
    }).finally(() => {
      if (!controller.signal.aborted) setRefreshing(false);
    });
    return () => controller.abort();
  }, [client, revision]);

  const filtered = useMemo(() => (queue ?? []).filter((item) =>
    (!experimentFilter || item.experimentId === experimentFilter) &&
    (!machineFilter || item.machineId === machineFilter) &&
    (!severityFilter || (item.severity ?? "NOT_PROVIDED") === severityFilter) &&
    (!statusFilter || item.status === statusFilter)),
  [queue, experimentFilter, machineFilter, severityFilter, statusFilter]);

  const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

  return (
    <AppShell title="Decision Center">
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeader title="Decision Center" eyebrow="Human-in-the-loop review" description="Prioritized machine recommendations from persisted experiment events. Reviews are recorded by the Maintenance API; no action is sent to a machine." actions={<button type="button" onClick={() => setRevision((value) => value + 1)} disabled={refreshing} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh queue</button>} />
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="note">Priority, risk, cost exposure, and review status are returned by the Maintenance API. Select View to open the complete recommendation on its own detail page.</div>
        {!queue && refreshing ? <AsyncState kind="loading" title="Loading decision queue" /> : null}
        {!queue && !refreshing && error ? <AsyncState kind="error" title="Decision queue unavailable" description={error} onRetry={() => setRevision((value) => value + 1)} /> : null}
        {queue ? <>
          {error ? <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />Refresh failed: {error}. Previously loaded rows remain visible.</div> : null}
          <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4" aria-label="Decision filters">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Filter className="h-4 w-4" /> Filter queue</div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs font-medium">Experiment<select aria-label="Filter by experiment" value={experimentFilter} onChange={(event) => setExperimentFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"><option value="">All experiments</option>{unique(queue.map((item) => item.experimentId)).map((id) => <option key={id} value={id}>{queue.find((item) => item.experimentId === id)?.experimentName ?? id}</option>)}</select></label>
              <label className="text-xs font-medium">Machine<select aria-label="Filter by machine" value={machineFilter} onChange={(event) => setMachineFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"><option value="">All machines</option>{unique(queue.map((item) => item.machineId)).map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
              <label className="text-xs font-medium">Severity<select aria-label="Filter by severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"><option value="">All severities</option>{unique(queue.map((item) => item.severity ?? "NOT_PROVIDED")).map((value) => <option key={value} value={value}>{value === "NOT_PROVIDED" ? "Not provided" : value}</option>)}</select></label>
              <label className="text-xs font-medium">Workflow status<select aria-label="Filter by workflow status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"><option value="">All statuses</option>{unique(queue.map((item) => item.status)).map((value) => <option key={value} value={value}>{DECISION_STATUS_LABELS[value as DecisionStatus]}</option>)}</select></label>
            </div>
          </section>
          <section aria-label="Priority decision queue" className="rounded-lg border border-[var(--color-stone-border)] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-stone-border)] p-4"><div><h2 className="text-base font-semibold">Priority queue</h2><p className="text-xs text-[var(--color-ash-gray)]">{filtered.length} of {queue.length} machine recommendations · sorted by backend severity and one-step delay exposure</p></div><ClipboardCheck className="h-5 w-5 text-[var(--color-chartwell-blue)]" /></div>
            {filtered.length === 0 ? <AsyncState kind="empty" compact title={queue.length ? "No matching decisions" : "No recommendations returned"} description={queue.length ? "Adjust filters to see more rows." : "No current-attempt recommendation events are available from the Maintenance API."} className="m-4 w-auto" /> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[var(--color-canvas-fog)] text-xs uppercase tracking-wide text-[var(--color-ash-gray)]"><tr><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Machine / tool</th><th className="px-4 py-3">Recommended action</th><th className="px-4 py-3">Failure risk</th><th className="px-4 py-3">Predicted cost</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Detail</th></tr></thead><tbody className="divide-y divide-[var(--color-stone-border)]">{filtered.map((item) => <tr key={item.rowId} className="hover:bg-stone-50"><td className="px-4 py-3 font-semibold">{display(item.severity)}</td><td className="px-4 py-3"><div className="font-mono font-semibold">{item.machineId}</div><div className="font-mono text-xs text-[var(--color-ash-gray)]">{display(item.toolId)}</div></td><td className="px-4 py-3 font-mono">{item.recommendedAction}</td><td className="px-4 py-3">{display(item.failureRisk)}</td><td className="px-4 py-3">{display(item.predictedExpectedCost)}</td><td className="px-4 py-3"><DecisionStatusBadge value={item.status} /></td><td className="px-4 py-3"><Link href={decisionDetailHref(item.rowId)} aria-label={`View decision detail for ${item.machineId} at step ${item.step}`} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 hover:underline">View <ChevronRight className="h-4 w-4" /></Link></td></tr>)}</tbody></table></div>}
          </section>
        </> : null}
      </main>
    </AppShell>
  );
}
