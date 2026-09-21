"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { DecisionDetail, DecisionReviewModal } from "@/components/decisions/decision-detail";
import { AsyncState } from "@/components/research/async-state";
import { PageHeader } from "@/components/research/page-header";
import { getUserFromToken } from "@/lib/auth";
import { getDecisionApiClient } from "@/lib/decision-api";
import { isProductApiError, productApiErrorMessage } from "@/lib/product-api/errors";
import type { JointAction } from "@/types/cnc";
import type { DecisionApiClient, DecisionContext, DecisionHistory, DecisionQueueItem, DecisionStatus, ReviewAction } from "@/types/decision";

function routeValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function DecisionDetailPage({ api, canReview: canReviewOverride, rowId: rowIdOverride }: {
  api?: DecisionApiClient;
  canReview?: boolean;
  rowId?: string;
} = {}) {
  const params = useParams<{ rowId: string | string[] }>();
  const rowId = rowIdOverride ?? routeValue(params?.rowId);
  const client = useMemo(() => api ?? getDecisionApiClient(), [api]);
  const [canReview, setCanReview] = useState(canReviewOverride ?? false);
  const [item, setItem] = useState<DecisionQueueItem | null>(null);
  const [context, setContext] = useState<DecisionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
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
    if (!rowId) {
      setLoading(false);
      setLoadError("Decision identifier is missing.");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    setItem(null);
    setContext(null);
    void client.listQueue({ signal: controller.signal }).then(async (queue) => {
      const selected = queue.find((candidate) => candidate.rowId === rowId);
      if (!selected) throw new Error("The selected decision is no longer available in the priority queue.");
      const result = await client.getContext(selected, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setItem(selected);
        setContext(result);
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError(productApiErrorMessage(reason, "Decision detail could not be loaded."));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [client, revision, rowId]);

  useEffect(() => {
    if (!item?.decisionId) {
      setHistory(null);
      setHistoryError("");
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    void client.getHistory(item.decisionId, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setHistory(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setHistoryError(productApiErrorMessage(reason, "Decision history could not be loaded."));
    }).finally(() => {
      if (!controller.signal.aborted) setHistoryLoading(false);
    });
    return () => controller.abort();
  }, [client, historyRevision, item?.decisionId]);

  const setDecisionStatus = (decisionId: string, status: DecisionStatus) => {
    setItem((current) => current ? { ...current, decisionId, status } : current);
  };

  const submit = async (reason: string, replacementAction?: JointAction) => {
    if (!item || !modal || mutationLock.current) return;
    mutationLock.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const decision = await client.openReview(item.recommendationId);
      setDecisionStatus(decision.id, decision.status);
      if (decision.status !== "PENDING_REVIEW") {
        setSubmitError("Conflict: this recommendation has already been reviewed. The latest decision is now shown.");
        setHistoryRevision((value) => value + 1);
        return;
      }
      await client.submitReview(decision.id, modal, replacementAction
        ? { reason, replacementAction }
        : reason ? { reason } : {});
      const status = modal === "approve" ? "APPROVED" : modal === "reject" ? "REJECTED" : "OVERRIDDEN";
      setDecisionStatus(decision.id, status);
      setModal(null);
      setHistoryRevision((value) => value + 1);
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

  const detailItem = item && context ? { ...item, ...context } : null;

  return (
    <AppShell title="Decision Detail">
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeader title="Decision Detail" eyebrow="Human-in-the-loop review" description="Inspect one complete recommendation, its returned risk context and audit history on a dedicated page." actions={<div className="flex flex-wrap gap-2"><Link href="/decisions" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium"><ArrowLeft className="h-4 w-4" /> Back to queue</Link><button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh detail</button></div>} />
        {loading ? <AsyncState kind="loading" title="Loading decision detail" /> : null}
        {!loading && loadError ? <AsyncState kind="error" title="Decision detail unavailable" description={loadError} onRetry={() => setRevision((value) => value + 1)} /> : null}
        {!loading && detailItem ? <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-6"><DecisionDetail item={detailItem} history={history} historyLoading={historyLoading} historyError={historyError} canReview={canReview} onRetryHistory={() => setHistoryRevision((value) => value + 1)} onAction={(action) => { setSubmitError(""); setModal(action); }} /></section> : null}
      </main>
      {detailItem && modal ? <DecisionReviewModal key={`${detailItem.rowId}:${modal}`} item={detailItem} action={modal} busy={submitting} error={submitError} onClose={() => { if (!submitting) setModal(null); }} onSubmit={(reason, replacementAction) => void submit(reason, replacementAction)} /> : null}
    </AppShell>
  );
}
