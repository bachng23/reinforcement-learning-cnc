"use client";

import { FileJson2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DecisionControls } from "@/components/operations/decision-controls";
import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { isSelectableRecommendationCandidate, RecommendationPackageView } from "@/components/operations/recommendation-package-view";
import { AsyncState } from "@/components/research/async-state";
import {
  getOperationsApiClient,
  getOperationsApiMode,
  type OperationsApiClient,
  type OperationsApiMode,
} from "@/lib/operations-api";
import { formatDateTime } from "@/lib/operations/format";
import {
  createMockRecommendationCenterDataSource,
  createRealRecommendationCenterDataSource,
  getRecommendationCenterCaseId,
  useRecommendationCenter,
  type RecommendationCenterDataSource,
  type RecommendationCenterPreviewData,
  type RecommendationCenterStatusData,
} from "@/lib/recommendation-center";
import type { HumanDecisionRequest } from "@/types/generated/operations";

function PreviewRecommendation({ data }: { data: RecommendationCenterPreviewData }) {
  const recommendation = data.recommendation;
  const decisionCase = data.caseStatus;
  const [selectedPlanId, setSelectedPlanId] = useState(recommendation.recommended_plan_id);
  const [preview, setPreview] = useState<HumanDecisionRequest | null>(null);
  const selected = recommendation.snapshot_id === data.snapshot.snapshot_id
    ? recommendation.candidate_plans.find((plan) =>
      plan.candidate_plan_id === selectedPlanId &&
      isSelectableRecommendationCandidate(plan, recommendation, data.snapshot))
    : undefined;

  return (
    <>
      <OperationsPanel title="Decision case" description="Canonical preview case and trigger context.">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <div><p className="text-xs text-[var(--color-ash-gray)]">Case</p><p className="mt-1 break-all font-mono text-sm font-semibold">{decisionCase.decision_case_id}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Snapshot</p><p className="mt-1 break-all font-mono text-sm font-semibold">{decisionCase.snapshot_id}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Mode</p><p className="mt-1"><OperationsStatus value={decisionCase.mode} /></p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Workflow status</p><p className="mt-1"><OperationsStatus value={decisionCase.status} /></p></div>
        </div>
      </OperationsPanel>

      <RecommendationPackageView recommendation={recommendation} snapshot={data.snapshot} selectedCandidateId={selectedPlanId} onSelectCandidate={setSelectedPlanId} />

      {selected ? (
        <OperationsPanel title="Approval / modify / reject" description="Preview-only controls build a request without sending it to an API.">
          <DecisionControls
            decisionCaseId={decisionCase.decision_case_id}
            recommendationId={recommendation.recommendation_id}
            snapshotId={recommendation.snapshot_id}
            selectedCandidate={selected}
            modifiedSchedule={data.modifiedSchedule}
            onDecision={setPreview}
          />
        </OperationsPanel>
      ) : null}

      {preview ? (
        <OperationsPanel title="Fixture payload preview" description="This request has not been sent. Real mode does not expose these controls until a write contract is available.">
          <div className="p-4 sm:p-5">
            <p role="status" className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700"><FileJson2 className="h-4 w-4" />{preview.decision} request ready for adapter integration</p>
            <pre className="max-h-96 overflow-auto rounded-md bg-stone-950 p-4 text-xs text-stone-100">{JSON.stringify(preview, null, 2)}</pre>
          </div>
        </OperationsPanel>
      ) : null}
    </>
  );
}

function RealCaseStatus({ data }: { data: RecommendationCenterStatusData }) {
  const decisionCase = data.caseStatus;
  return (
    <>
      <OperationsPanel title="Decision case status" description="Authoritative status returned by OperationsApiClient.getDecisionCase().">
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <div><p className="text-xs text-[var(--color-ash-gray)]">Case</p><p className="mt-1 break-all font-mono text-sm font-semibold">{decisionCase.decision_case_id}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Snapshot</p><p className="mt-1 break-all font-mono text-sm font-semibold">{decisionCase.snapshot_id}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Mode</p><p className="mt-1"><OperationsStatus value={decisionCase.mode} /></p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Workflow status</p><p className="mt-1"><OperationsStatus value={decisionCase.status} /></p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Recommendation reference</p><p className="mt-1 break-all font-mono text-sm font-semibold">{decisionCase.recommendation_id ?? "Not provided"}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Created</p><p className="mt-1 text-sm font-semibold">{formatDateTime(decisionCase.created_at)}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Updated</p><p className="mt-1 text-sm font-semibold">{formatDateTime(decisionCase.updated_at)}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Committed schedule</p><p className="mt-1 break-all font-mono text-sm font-semibold">{decisionCase.committed_schedule_id ?? "Not provided"}</p></div>
        </div>
      </OperationsPanel>

      <AsyncState
        kind="empty"
        title="Recommendation package not available"
        description="The real Decision Case API currently returns status only. Candidate plans, KPIs, evidence and schedules will remain hidden until an authoritative RecommendationPackage read contract is available."
      />

      <div role="note" className="rounded-md border border-dashed border-[var(--color-stone-border)] bg-white p-4 text-sm text-[var(--color-ash-gray)]">
        Approval, modify and reject controls are not available in real mode because no supported decision-submit flow is connected here.
      </div>
    </>
  );
}

export function RecommendationCenterPage({
  dataSource,
  caseId,
  api,
  apiMode,
}: {
  dataSource?: RecommendationCenterDataSource;
  caseId?: string;
  api?: OperationsApiClient;
  apiMode?: OperationsApiMode;
} = {}) {
  const configuredMode = dataSource?.mode ?? apiMode ?? getOperationsApiMode();
  const source = useMemo(() => {
    if (dataSource) return dataSource;
    if (configuredMode === "mock") return createMockRecommendationCenterDataSource();
    return createRealRecommendationCenterDataSource(api ?? getOperationsApiClient());
  }, [api, configuredMode, dataSource]);
  const selectedCaseId = caseId ?? getRecommendationCenterCaseId();
  const { state, retry } = useRecommendationCenter({ dataSource: source, caseId: selectedCaseId });

  return (
    <OperationsShell
      title="Recommendation Center"
      description="Inspect authoritative decision status and compare recommendation candidates only when the selected data source provides them."
      dataSource={source.mode === "real" ? "live" : "fixture"}
      dataSourceMessage={source.mode === "real"
        ? "Live Operations API mode. Decision case status is rendered exactly as returned; no preview recommendation data is injected."
        : "Preview mode uses the canonical recommendation fixture. Decision controls build a payload preview and do not submit it."}
      actions={state.kind === "missing-case-id" ? undefined : (
        <button
          type="button"
          onClick={retry}
          disabled={state.kind === "loading"}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />
          Refresh
        </button>
      )}
    >
      {state.kind === "loading" ? <AsyncState kind="loading" title="Loading decision case" description={`Requesting authoritative status for ${selectedCaseId ?? "the selected case"}.`} /> : null}
      {state.kind === "missing-case-id" ? <AsyncState kind="empty" title="Decision case ID required" description="Open this page with ?caseId=... or configure NEXT_PUBLIC_OPERATIONS_DECISION_CASE_ID before using real mode." /> : null}
      {state.kind === "unauthorized" ? <AsyncState kind="error" title="Recommendation access required" description={state.message} action={<Link href="/login" className="inline-flex min-h-10 items-center rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium">Sign in</Link>} /> : null}
      {state.kind === "not-found" ? <AsyncState kind="empty" title="Decision case not found" description={state.message} onRetry={retry} retryLabel="Retry case" /> : null}
      {state.kind === "conflict" ? <AsyncState kind="error" title="Decision case changed" description={state.message} onRetry={retry} retryLabel="Refresh case" /> : null}
      {state.kind === "unavailable" ? <AsyncState kind="empty" title="Recommendation service unavailable" description={state.message} onRetry={retry} retryLabel="Retry case" /> : null}
      {state.kind === "network-error" || state.kind === "error" ? <AsyncState kind="error" title="Recommendation data could not be loaded" description={state.message} onRetry={retry} /> : null}
      {state.kind === "ready" && state.data.source === "mock" ? <PreviewRecommendation key={state.data.recommendation.recommendation_id} data={state.data} /> : null}
      {state.kind === "ready" && state.data.source === "real" ? <RealCaseStatus data={state.data} /> : null}
    </OperationsShell>
  );
}
