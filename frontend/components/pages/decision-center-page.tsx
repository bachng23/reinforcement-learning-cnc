"use client";

import { AlertTriangle, Check, ChevronRight, ClipboardCheck, Filter, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { AsyncState } from "@/components/research/async-state";
import { PageHeader } from "@/components/research/page-header";
import { RulDistributionChart } from "@/components/research/rul-distribution-chart";
import { getUserFromToken } from "@/lib/auth";
import { getDecisionApiClient } from "@/lib/decision-api";
import { isProductApiError, productApiErrorMessage } from "@/lib/product-api/errors";
import type { JointAction, ToolAction } from "@/types/cnc";
import type { DecisionApiClient, DecisionContext, DecisionHistory, DecisionQueueItem, DecisionStatus, ReviewAction } from "@/types/decision";

type DecisionDetailItem = DecisionQueueItem & DecisionContext;

const STATUS_LABELS: Record<DecisionStatus, string> = {
  NOT_OPENED: "Not opened",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  OVERRIDDEN: "Overridden",
};

function display(value: string | number | null | undefined): string {
  return value === undefined || value === null || value === "" ? "Not provided" : String(value);
}

function date(value?: string): string {
  if (!value) return "Not provided";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function statusClass(status: DecisionStatus): string {
  if (status === "APPROVED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "REJECTED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "OVERRIDDEN") return "border-violet-200 bg-violet-50 text-violet-800";
  if (status === "PENDING_REVIEW") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

function Status({ value }: { value: DecisionStatus }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(value)}`}>{STATUS_LABELS[value]}</span>;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="rounded-md border border-[var(--color-stone-border)] bg-white p-3"><dt className="text-xs text-[var(--color-ash-gray)]">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-[var(--color-slate-text)]">{display(value)}</dd></div>;
}

function ReviewModal({
  item,
  action,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  item: DecisionDetailItem;
  action: ReviewAction;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (reason: string, replacementAction?: JointAction) => void;
}) {
  const [reason, setReason] = useState("");
  const [choices, setChoices] = useState<Record<string, ToolAction>>(
    Object.fromEntries(item.recommendation.actions.actions.map((entry) => [entry.machine_id, entry.action])),
  );
  const [validation, setValidation] = useState("");
  const original = item.recommendation.actions.actions;
  const changed = original.some((entry) => choices[entry.machine_id] !== entry.action);

  const submit = () => {
    if (action === "override" && !reason.trim()) {
      setValidation("Override reason is required.");
      return;
    }
    if (action === "override" && !changed) {
      setValidation("Change at least one machine action to override the policy.");
      return;
    }
    setValidation("");
    onSubmit(reason.trim(), action === "override" ? {
      schema_version: "2.0",
      observation_id: item.observationKey,
      actions: original.map((entry) => ({ machine_id: entry.machine_id, action: choices[entry.machine_id] })),
    } : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="review-modal-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--color-stone-border)] bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">Human review</p><h2 id="review-modal-title" className="mt-1 text-xl font-semibold capitalize">{action} recommendation</h2></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close review modal" className="rounded-md p-2 hover:bg-stone-100 disabled:opacity-50"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-sm text-[var(--color-ash-gray)]">This records a review decision for the complete joint recommendation, not just {item.machineId}. It does not execute a machine action.</p>
        {action === "override" ? (
          <fieldset className="mt-5 space-y-3">
            <legend className="text-sm font-semibold">Replacement action for every machine</legend>
            {original.map((entry) => (
              <label key={entry.machine_id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-stone-border)] p-3 text-sm">
                <span className="font-mono">{entry.machine_id}</span>
                <select aria-label={`Action for ${entry.machine_id}`} value={choices[entry.machine_id]} onChange={(event) => setChoices((current) => ({ ...current, [entry.machine_id]: event.target.value as ToolAction }))} disabled={busy} className="rounded-md border border-[var(--color-stone-border)] bg-white px-2 py-1.5">
                  <option value="CONTINUE">CONTINUE</option><option value="REPLACE">REPLACE</option>
                </select>
              </label>
            ))}
          </fieldset>
        ) : null}
        <label htmlFor="review-reason" className="mt-5 block text-sm font-semibold">Reason {action === "override" ? "(required)" : "(optional)"}</label>
        <textarea id="review-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={4000} rows={3} disabled={busy} className="mt-2 w-full rounded-md border border-[var(--color-stone-border)] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-chartwell-blue)]" placeholder="Record the review rationale" />
        {validation || error ? <p role="alert" className="mt-3 text-sm text-rose-700">{validation || error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-[var(--color-stone-border)] px-4 py-2 text-sm font-medium disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-[var(--color-slate-text)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {busy ? "Submitting…" : `Confirm ${action}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function Detail({ item, history, loading, error, canReview, onRetryHistory, onAction }: {
  item: DecisionDetailItem;
  history: DecisionHistory | null;
  loading: boolean;
  error: string;
  canReview: boolean;
  onRetryHistory: () => void;
  onAction: (action: ReviewAction) => void;
}) {
  const machine = item.observation.machines.find((value) => value.machine_id === item.machineId);
  const tool = machine?.tool_state;
  const risk = item.environmentConfig.risk;
  const inventory = item.observation.inventory;
  const isPending = item.status === "PENDING_REVIEW";

  return (
    <div className="space-y-5" aria-label="Decision detail">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-stone-border)] pb-4">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">Decision detail · step {item.step}</p><h2 className="mt-1 text-xl font-semibold">{item.machineId} / {display(item.toolId)}</h2><p className="mt-1 text-xs text-[var(--color-ash-gray)]">{item.experimentName} · episode {item.episodeId} · attempt {item.attempt}</p></div>
        <Status value={item.status} />
      </div>

      <section aria-labelledby="why-heading" className="space-y-3">
        <h3 id="why-heading" className="text-base font-semibold">Why this recommendation?</h3>
        <p className="text-sm text-[var(--color-ash-gray)]">The following values are returned by the observation and experiment configuration. The frontend does not calculate failure risk or RUL.</p>
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Observed wear (µm)" value={tool?.observed_wear_um} />
          <Field label="Posterior median wear (µm)" value={tool?.posterior_median_wear_um} />
          <Field label="Posterior wear uncertainty (µm)" value={tool?.posterior_std_wear_um} />
          <Field label="Failure threshold (µm)" value={item.environmentConfig.failure_threshold_um} />
          <Field label="Failure risk" value={item.failureRisk} />
          <Field label="Risk objective" value={risk.objective} />
          <Field label="Spare tools available" value={inventory.spares_available} />
          <Field label="Spare capacity" value={inventory.capacity} />
          <Field label="Load class" value={machine?.cutting_condition.load_class} />
        </dl>
        {tool?.rul_distribution ? <RulDistributionChart distribution={tool.rul_distribution} title={`Returned RUL distribution · ${item.machineId}`} /> : <AsyncState kind="empty" compact title="RUL distribution not provided" />}
      </section>

      <section className="space-y-3 border-t border-[var(--color-stone-border)] pt-5" aria-labelledby="policy-heading">
        <h3 id="policy-heading" className="text-base font-semibold">Policy recommendation and defer consequence</h3>
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Recommended action" value={item.recommendedAction} />
          <Field label="Policy ID" value={item.recommendation.policy_id} />
          <Field label="Policy estimated expected cost (joint)" value={item.predictedExpectedCost} />
          <Field label="Policy estimated CVaR cost (joint)" value={item.predictedCvarCost} />
          <Field label="One-step delay exposure" value={item.costOfDelay} />
          <Field label="Severity" value={item.severity} />
        </dl>
        <p className="text-xs text-[var(--color-ash-gray)]">Cost estimates apply to the policy&apos;s joint fleet recommendation; they are not per-machine or recalculated values.</p>
        <div className="rounded-md border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] p-3"><p className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">Full joint action under review</p><div className="mt-2 flex flex-wrap gap-2">{item.recommendation.actions.actions.map((entry) => <span key={entry.machine_id} className="rounded-full border bg-white px-2.5 py-1 font-mono text-xs">{entry.machine_id}: {entry.action}</span>)}</div></div>
      </section>

      <section className="space-y-3 border-t border-[var(--color-stone-border)] pt-5" aria-labelledby="history-heading">
        <h3 id="history-heading" className="text-base font-semibold">Review history / audit trail</h3>
        {loading ? <AsyncState kind="loading" compact title="Loading decision history" /> : null}
        {error ? <AsyncState kind="error" compact description={error} onRetry={onRetryHistory} /> : null}
        {!loading && !error && !item.decisionId ? <AsyncState kind="empty" compact title="Review not opened" description="No human review has been created for this recommendation." /> : null}
        {!loading && !error && item.decisionId && history?.actions.length === 0 ? <AsyncState kind="empty" compact title="No actions recorded" description="This decision is pending human review." /> : null}
        {!loading && !error && history?.actions.length ? <ol className="space-y-2">{history.actions.map((entry) => <li key={entry.id} className="rounded-md border border-[var(--color-stone-border)] bg-white p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.fromStatus} → {entry.toStatus}</strong><time dateTime={entry.createdAt} className="text-xs text-[var(--color-ash-gray)]">{date(entry.createdAt)}</time></div><p className="mt-1 text-xs text-[var(--color-ash-gray)]">Actor: {entry.actorUserId}</p><p className="mt-1">Reason: {display(entry.reason)}</p><details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Recorded action and snapshots</summary><pre className="mt-2 max-h-56 overflow-auto rounded-md bg-stone-50 p-2">{JSON.stringify({ selectedAction: entry.selectedAction, recommendationSnapshot: entry.recommendationSnapshot, riskSnapshot: entry.riskSnapshot }, null, 2)}</pre></details></li>)}</ol> : null}
      </section>

      {isPending && canReview ? <div className="flex flex-wrap gap-2 border-t border-[var(--color-stone-border)] pt-5"><button type="button" onClick={() => onAction("approve")} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Approve</button><button type="button" onClick={() => onAction("reject")} className="rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700">Reject</button><button type="button" onClick={() => onAction("override")} className="rounded-md border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700">Override</button></div> : null}
      {isPending && !canReview ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This account can read decisions but cannot submit a human review.</p> : null}
    </div>
  );
}

export function DecisionCenterPage({ api, canReview: canReviewOverride }: { api?: DecisionApiClient; canReview?: boolean } = {}) {
  const client = useMemo(() => api ?? getDecisionApiClient(), [api]);
  const [canReview, setCanReview] = useState(canReviewOverride ?? false);
  const [queue, setQueue] = useState<DecisionQueueItem[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [experimentFilter, setExperimentFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [context, setContext] = useState<DecisionContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [contextLoading, setContextLoading] = useState(false);
  const [history, setHistory] = useState<DecisionHistory | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [modal, setModal] = useState<ReviewAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const mutationLock = useRef(false);

  useEffect(() => {
    if (canReviewOverride !== undefined) return;
    let live = true;
    void getUserFromToken().then((user) => {
      if (live) setCanReview(Boolean(user && ["ADMIN", "ENGINEER", "OPERATOR"].includes(user.role)));
    });
    return () => { live = false; };
  }, [canReviewOverride]);

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

  const selected = queue?.find((item) => item.rowId === selectedId) ?? null;
  useEffect(() => {
    if (!selected) {
      setContext(null);
      setContextError("");
      setContextLoading(false);
      return;
    }
    const controller = new AbortController();
    setContext(null);
    setContextError("");
    setContextLoading(true);
    void client.getContext(selected, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setContext(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setContextError(productApiErrorMessage(reason, "Decision context could not be loaded."));
    }).finally(() => {
      if (!controller.signal.aborted) setContextLoading(false);
    });
    return () => controller.abort();
  }, [client, selected]);
  useEffect(() => {
    if (!selected?.decisionId) {
      setHistory(null);
      setHistoryError("");
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    void client.getHistory(selected.decisionId, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setHistory(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setHistoryError(productApiErrorMessage(reason, "Decision history could not be loaded."));
    }).finally(() => {
      if (!controller.signal.aborted) setHistoryLoading(false);
    });
    return () => controller.abort();
  }, [client, selected?.decisionId, historyRevision]);

  const filtered = useMemo(() => (queue ?? []).filter((item) =>
    (!experimentFilter || item.experimentId === experimentFilter) &&
    (!machineFilter || item.machineId === machineFilter) &&
    (!severityFilter || (item.severity ?? "NOT_PROVIDED") === severityFilter) &&
    (!statusFilter || item.status === statusFilter)),
  [queue, experimentFilter, machineFilter, severityFilter, statusFilter]);

  const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  const setDecisionStatus = (recommendationId: string, decisionId: string, status: DecisionStatus) => {
    setQueue((items) => items?.map((item) => item.recommendationId === recommendationId
      ? { ...item, decisionId, status }
      : item) ?? null);
  };

  const submit = async (reason: string, replacementAction?: JointAction) => {
    if (!selected || !modal || mutationLock.current) return;
    mutationLock.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const decision = await client.openReview(selected.recommendationId);
      setDecisionStatus(selected.recommendationId, decision.id, decision.status);
      if (decision.status !== "PENDING_REVIEW") {
        setSubmitError("Conflict: this recommendation has already been reviewed. The latest decision is now shown.");
        setHistoryRevision((value) => value + 1);
        return;
      }
      await client.submitReview(decision.id, modal, replacementAction
        ? { reason, replacementAction }
        : reason ? { reason } : {});
      const status = modal === "approve" ? "APPROVED" : modal === "reject" ? "REJECTED" : "OVERRIDDEN";
      setDecisionStatus(selected.recommendationId, decision.id, status);
      setModal(null);
      setHistoryRevision((value) => value + 1);
      setRevision((value) => value + 1);
    } catch (reason) {
      setSubmitError(productApiErrorMessage(reason, "Decision could not be submitted."));
      if (isProductApiError(reason) && reason.status === 409) {
        setHistoryRevision((value) => value + 1);
        setRevision((value) => value + 1);
      }
    } finally {
      mutationLock.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AppShell title="Decision Center">
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeader title="Decision Center" eyebrow="Human-in-the-loop review" description="Prioritized machine recommendations from persisted experiment events. Reviews are recorded by the Maintenance API; no action is sent to a machine." actions={<button type="button" onClick={() => setRevision((value) => value + 1)} disabled={refreshing} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh queue</button>} />
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="note">Priority, risk, cost exposure, and review status are returned by the Maintenance API. Opening a row loads its source context for review without recalculating the recommendation in the browser.</div>
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
              <label className="text-xs font-medium">Workflow status<select aria-label="Filter by workflow status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"><option value="">All statuses</option>{unique(queue.map((item) => item.status)).map((value) => <option key={value} value={value}>{STATUS_LABELS[value as DecisionStatus]}</option>)}</select></label>
            </div>
          </section>
          <section aria-label="Priority decision queue" className="rounded-lg border border-[var(--color-stone-border)] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-stone-border)] p-4"><div><h2 className="text-base font-semibold">Priority queue</h2><p className="text-xs text-[var(--color-ash-gray)]">{filtered.length} of {queue.length} machine recommendations · sorted by backend severity and one-step delay exposure</p></div><ClipboardCheck className="h-5 w-5 text-[var(--color-chartwell-blue)]" /></div>
            {filtered.length === 0 ? <AsyncState kind="empty" compact title={queue.length ? "No matching decisions" : "No recommendations returned"} description={queue.length ? "Adjust filters to see more rows." : "No current-attempt recommendation events are available from the Maintenance API."} className="m-4 w-auto" /> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[var(--color-canvas-fog)] text-xs uppercase tracking-wide text-[var(--color-ash-gray)]"><tr><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Machine / tool</th><th className="px-4 py-3">Recommended action</th><th className="px-4 py-3">Failure risk</th><th className="px-4 py-3">Predicted cost</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Detail</th></tr></thead><tbody className="divide-y divide-[var(--color-stone-border)]">{filtered.map((item) => <tr key={item.rowId} tabIndex={0} onClick={() => { setSelectedId(item.rowId); setHistory(null); setHistoryError(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(item.rowId); setHistory(null); setHistoryError(""); } }} aria-label={`Open decision detail for ${item.machineId} at step ${item.step}`} className={`cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500 ${selectedId === item.rowId ? "bg-sky-50" : "hover:bg-stone-50"}`}><td className="px-4 py-3 font-semibold">{display(item.severity)}</td><td className="px-4 py-3"><div className="font-mono font-semibold">{item.machineId}</div><div className="font-mono text-xs text-[var(--color-ash-gray)]">{display(item.toolId)}</div></td><td className="px-4 py-3 font-mono">{item.recommendedAction}</td><td className="px-4 py-3">{display(item.failureRisk)}</td><td className="px-4 py-3">{display(item.predictedExpectedCost)}</td><td className="px-4 py-3"><Status value={item.status} /></td><td className="px-4 py-3"><button type="button" onClick={() => { setSelectedId(item.rowId); setHistory(null); setHistoryError(""); }} aria-label={`Open decision detail for ${item.machineId} at step ${item.step}`} className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:underline">View <ChevronRight className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>}
          </section>
          {selected ? <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-6" id="decision-detail">{contextLoading ? <AsyncState kind="loading" compact title="Loading decision context" /> : null}{contextError ? <AsyncState kind="error" compact description={contextError} onRetry={() => setSelectedId(null)} /> : null}{context ? <Detail item={{ ...selected, ...context }} history={history} loading={historyLoading} error={historyError} canReview={canReview} onRetryHistory={() => setHistoryRevision((value) => value + 1)} onAction={(action) => { setSubmitError(""); setModal(action); }} /> : null}</section> : null}
        </> : null}
      </main>
      {selected && context && modal ? <ReviewModal key={`${selected.rowId}:${modal}`} item={{ ...selected, ...context }} action={modal} busy={submitting} error={submitError} onClose={() => { if (!submitting) setModal(null); }} onSubmit={(reason, replacementAction) => void submit(reason, replacementAction)} /> : null}
    </AppShell>
  );
}
