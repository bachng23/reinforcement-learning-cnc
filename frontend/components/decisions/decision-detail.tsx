"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import { AsyncState } from "@/components/research/async-state";
import { RulDistributionChart } from "@/components/research/rul-distribution-chart";
import type { JointAction, ToolAction } from "@/types/cnc";
import type { DecisionContext, DecisionHistory, DecisionQueueItem, DecisionStatus, ReviewAction } from "@/types/decision";

export type DecisionDetailItem = DecisionQueueItem & DecisionContext;

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
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

export function DecisionStatusBadge({ value }: { value: DecisionStatus }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(value)}`}>{DECISION_STATUS_LABELS[value]}</span>;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="rounded-md border border-[var(--color-stone-border)] bg-white p-3"><dt className="text-xs text-[var(--color-ash-gray)]">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-[var(--color-slate-text)]">{display(value)}</dd></div>;
}

export function DecisionReviewModal({
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

export function DecisionDetail({ item, history, historyLoading, historyError, canReview, onRetryHistory, onAction }: {
  item: DecisionDetailItem;
  history: DecisionHistory | null;
  historyLoading: boolean;
  historyError: string;
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
        <DecisionStatusBadge value={item.status} />
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
        {historyLoading ? <AsyncState kind="loading" compact title="Loading decision history" /> : null}
        {historyError ? <AsyncState kind="error" compact description={historyError} onRetry={onRetryHistory} /> : null}
        {!historyLoading && !historyError && !item.decisionId ? <AsyncState kind="empty" compact title="Review not opened" description="No human review has been created for this recommendation." /> : null}
        {!historyLoading && !historyError && item.decisionId && history?.actions.length === 0 ? <AsyncState kind="empty" compact title="No actions recorded" description="This decision is pending human review." /> : null}
        {!historyLoading && !historyError && history?.actions.length ? <ol className="space-y-2">{history.actions.map((entry) => <li key={entry.id} className="rounded-md border border-[var(--color-stone-border)] bg-white p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.fromStatus} → {entry.toStatus}</strong><time dateTime={entry.createdAt} className="text-xs text-[var(--color-ash-gray)]">{date(entry.createdAt)}</time></div><p className="mt-1 text-xs text-[var(--color-ash-gray)]">Actor: {entry.actorUserId}</p><p className="mt-1">Reason: {display(entry.reason)}</p><details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Recorded action and snapshots</summary><pre className="mt-2 max-h-56 overflow-auto rounded-md bg-stone-50 p-2">{JSON.stringify({ selectedAction: entry.selectedAction, recommendationSnapshot: entry.recommendationSnapshot, riskSnapshot: entry.riskSnapshot }, null, 2)}</pre></details></li>)}</ol> : null}
      </section>

      {isPending && canReview ? <div className="flex flex-wrap gap-2 border-t border-[var(--color-stone-border)] pt-5"><button type="button" onClick={() => onAction("approve")} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Approve</button><button type="button" onClick={() => onAction("reject")} className="rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700">Reject</button><button type="button" onClick={() => onAction("override")} className="rounded-md border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700">Override</button></div> : null}
      {isPending && !canReview ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This account can read decisions but cannot submit a human review.</p> : null}
    </div>
  );
}
