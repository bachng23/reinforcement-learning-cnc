"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { OperationsPanel } from "./operations-shell";
import { candidateRejectionReason, recommendationPackageFailure } from "./recommendation-package-view";
import { CurrentSchedule } from "@/components/pages/integrated-schedule-page";
import { AsyncState } from "@/components/research/async-state";
import { OperationsApiError, type OperationsApiClient, type OperationsDecisionCommand, type OperationsDecisionCaseReadResponse, type OperationsCommitMetadata } from "@/lib/operations-api/client";
import { useOperationsAction } from "@/lib/operations-api/use-operations-action";
import { getOperationsActorId } from "@/lib/operations-api/actor";
import { useOperationsContext } from "@/lib/operations-api/use-operations-context";
import type { RecommendationCenterStatusData } from "@/lib/recommendation-center";
import { formatDateTime } from "@/lib/operations/format";
import type { CandidatePlan } from "@/types/generated/operations";

type ReadyData = Extract<RecommendationCenterStatusData, { artifactState: "ready" }>;
type Choice = OperationsDecisionCommand["command"];
const button = "min-h-10 rounded-md border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";

function commandDisabledReason(data: ReadyData, choice: Choice, candidate: CandidatePlan | undefined): string | undefined {
  const meta = data.caseMeta;
  const context = meta?.current_context;
  const packageError = recommendationPackageFailure(data.recommendation, data.snapshot);
  if (packageError) return packageError;
  if (!meta || !context || !Number.isInteger(meta.case_revision) || meta.case_revision < 1
    || !Number.isInteger(meta.base_plan_version) || meta.base_plan_version < 0) return "Authoritative command context is not available.";
  if (meta.stale || context.snapshot_id !== data.snapshot.snapshot_id || context.plan_version !== meta.base_plan_version) return "The basis is stale. Create a new case from the latest Overview context.";
  if (!meta.available_commands?.includes(choice)) return "The backend does not permit this command for your access and the current case state.";
  if (choice === "REJECT") return data.caseStatus.status === "AWAITING_APPROVAL" ? undefined : "Rejection is unavailable in this state.";
  if (!candidate) return "Select a validated candidate first.";
  const candidateError = candidateRejectionReason(candidate, data.recommendation, data.snapshot);
  if (candidateError) return candidateError;
  if (choice === "APPROVE" && data.caseStatus.status !== "AWAITING_APPROVAL") return "Approval is unavailable in this state.";
  if (choice === "COMMIT") {
    const approved = meta.approved_candidate;
    const human = meta.human_decision;
    if (data.caseStatus.mode !== "LIVE" || data.caseStatus.status !== "APPROVED") return "Only an approved LIVE case can publish a schedule.";
    if (!approved || approved.recommendation_id !== data.recommendation.recommendation_id
      || approved.candidate_plan_id !== candidate.candidate_plan_id || approved.candidate_version !== candidate.plan_version
      || human?.decision !== "APPROVE" || human.candidate_plan_id !== approved.candidate_plan_id
      || human.candidate_version !== approved.candidate_version || human.recommendation_id !== approved.recommendation_id
      || human.candidate_hash !== approved.candidate_hash || human.schedule_hash !== approved.schedule_hash) return "Approval provenance does not match the candidate. Refresh and review.";
  }
  return undefined;
}

export function PublishedDecisionSchedule({ api, commit }: { api: OperationsApiClient; commit: OperationsCommitMetadata }) {
  const { state, retry } = useOperationsContext({ api, factoryId: commit.factory_id });
  const publishedMismatch = state.kind === "ready" && (
    state.data.scheduleResponse.plan_version < commit.plan_version
    || (state.data.scheduleResponse.plan_version === commit.plan_version && (
      state.data.scheduleResponse.schedule?.schedule_id !== commit.schedule_id
      || state.data.scheduleResponse.schedule.revision !== commit.schedule_revision
      || state.data.scheduleResponse.basis_snapshot?.snapshot_id !== commit.snapshot_id
      || state.data.scheduleResponse.commit?.decision_case_id !== commit.decision_case_id
      || state.data.scheduleResponse.commit?.schedule_hash !== commit.schedule_hash
    ))
  );
  return (
    <OperationsPanel title="Published schedule" description="Current schedule reloaded from the backend after commit.">
      <div className="space-y-4 p-4 sm:p-5">
        <p role="status" className="break-words text-sm font-semibold text-emerald-800">Published plan version {commit.plan_version} · schedule <code className="break-all">{commit.schedule_id}</code></p>
        <p className="break-all text-xs">Committed by {commit.actor_id} at {formatDateTime(commit.committed_at)}</p>
        {state.kind === "loading" ? <AsyncState kind="loading" title="Refreshing published schedule" /> : null}
        {state.kind !== "loading" && state.kind !== "ready" ? <AsyncState kind="error" title="Published schedule could not be refreshed" description={state.message} onRetry={retry} /> : null}
        {publishedMismatch ? <AsyncState kind="error" title="Published schedule context mismatch" description="The read does not match this publication. Refresh to verify the current authoritative schedule." onRetry={retry} /> : null}
        {state.kind === "ready" && !publishedMismatch ? <CurrentSchedule data={state.data} /> : null}
        <div className="flex flex-wrap gap-3 text-sm"><Link className="underline" href="/operations">Open refreshed Overview</Link><Link className="underline" href="/operations/schedule">Open current Gantt</Link></div>
      </div>
    </OperationsPanel>
  );
}

export function LiveDecisionControls({ api, data, selectedCandidateId, refreshing, onRefresh }: {
  api: OperationsApiClient;
  data: ReadyData;
  selectedCandidateId: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [confirmation, setConfirmation] = useState<{ choice: Choice; candidate?: CandidatePlan } | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const approved = data.caseMeta?.approved_candidate;
  const selected = data.recommendation.candidate_plans.find(candidate => candidate.candidate_plan_id === selectedCandidateId);
  const approvedPlan = data.recommendation.candidate_plans.find(candidate => candidate.candidate_plan_id === approved?.candidate_plan_id);
  const action = useOperationsAction<OperationsDecisionCommand, OperationsDecisionCaseReadResponse>({
    scope: `${data.source}:decision:${data.caseStatus.decision_case_id}`,
    getActorId: data.source === "real" ? getOperationsActorId : undefined,
    send: async (body, options) => {
      const response = await api.submitDecisionCommand(data.caseStatus.decision_case_id, body, options);
      const expected = { APPROVE: "APPROVED", REJECT: "REJECTED", COMMIT: "COMMITTED" }[body.command];
      if (response.caseStatus.decision_case_id !== body.decision_case_id || response.caseStatus.status !== expected
        || response.caseStatus.snapshot_id !== body.expected_snapshot_id || response.caseStatus.recommendation_id !== body.recommendation_id
        || (body.command !== "REJECT" && (response.meta?.approved_candidate?.candidate_plan_id !== body.candidate_plan_id
          || response.meta.approved_candidate.candidate_version !== body.candidate_version))
        || (body.command === "COMMIT" && (!response.meta?.commit || response.meta.commit.decision_case_id !== body.decision_case_id))) {
        throw new OperationsApiError(502, null);
      }
      return response;
    },
    onAccepted: response => {
      setConfirmation(null);
      if (response.caseStatus.status === "COMMITTED") {
        window.dispatchEvent(new CustomEvent("operations-context-changed", { detail: { factoryId: data.snapshot.factory_id } }));
      }
      onRefresh();
    },
    onConflict: () => { setConfirmation(null); onRefresh(); },
  });
  const busy = action.busy || refreshing;
  const unresolved = action.hasUnresolvedAction;
  const needsReview = action.state.kind === "conflict";

  useEffect(() => {
    if (action.state.kind !== "accepted" || refreshing) return;
    const expected = { APPROVE: "APPROVED", REJECT: "REJECTED", COMMIT: "COMMITTED" }[action.state.action.body.command];
    if (data.caseStatus.status === expected) action.acknowledge();
  }, [action, data.caseStatus.status, refreshing]);

  useEffect(() => {
    if (confirmation && dialog.current && !dialog.current.open) {
      if (typeof dialog.current.showModal === "function") dialog.current.showModal();
      else dialog.current.setAttribute("open", "");
    }
  }, [confirmation]);

  const reason = (choice: Choice) => commandDisabledReason(data, choice, choice === "COMMIT" ? approvedPlan : selected);
  const open = (choice: Choice) => {
    if (busy || unresolved || needsReview || reason(choice)) return;
    setNote(""); setNoteError("");
    setConfirmation({ choice, candidate: choice === "COMMIT" ? approvedPlan : selected });
  };

  return (
    <OperationsPanel title="Human decision and publication" description={data.source === "real" ? "Approve records your decision. Commit is a separate action that publishes the approved schedule." : "Preview workflow uses the same request DTOs; changes stay in this mock adapter."}>
      <div className="space-y-4 p-4 sm:p-5">
        <p className="break-all text-xs">Case revision {data.caseMeta?.case_revision ?? "Not provided"} · head plan version {data.caseMeta?.current_context?.plan_version ?? "Not provided"}</p>
        {approved ? <p className="break-all text-sm">Approved candidate: <code>{approved.candidate_plan_id}</code> · candidate v{approved.candidate_version}. Commit always publishes this candidate, independent of the comparison selection.</p> : null}
        {data.caseMeta?.human_decision ? <p className="break-all text-xs">{data.caseMeta.human_decision.decision} by {data.caseMeta.human_decision.actor_id} at {formatDateTime(data.caseMeta.human_decision.decided_at)}{data.caseMeta.human_decision.note ? ` · ${data.caseMeta.human_decision.note}` : ""}</p> : null}
        <div className="flex flex-wrap gap-2">
          {(["APPROVE", "REJECT", "COMMIT"] as const).map(choice => <button key={choice} type="button" className={button} onClick={() => open(choice)} disabled={busy || unresolved || needsReview || !!reason(choice)} title={reason(choice)}>{choice === "APPROVE" ? "Approve" : choice === "REJECT" ? "Reject" : "Commit approved schedule"}</button>)}
          <button type="button" className={button} disabled title="Backend MODIFY and revalidation are not available.">Modify</button>
        </div>
        <p className="text-xs text-[var(--color-ash-gray)]">Modify is unavailable: the backend does not provide modification and revalidation commands.</p>
        {!["COMMITTED", "REJECTED"].includes(data.caseStatus.status) && reason(data.caseStatus.status === "APPROVED" ? "COMMIT" : "APPROVE") ? <p className="text-sm text-amber-800">{reason(data.caseStatus.status === "APPROVED" ? "COMMIT" : "APPROVE")}</p> : null}
        {busy ? <p role="status" aria-busy="true" className="text-sm">{action.busy ? "Submitting decision… Double submission is blocked." : "Refreshing authoritative case. Commands are temporarily disabled."}</p> : null}
        {!busy && action.state.kind !== "idle" ? <p role="alert" className="text-sm text-rose-800">{action.state.message}</p> : null}
        {action.state.kind === "recoverable" || action.state.kind === "unauthorized" ? <button type="button" disabled={busy} onClick={action.recover} className={button}>Recover decision outcome</button> : null}
        {action.state.kind === "accepted" && !refreshing ? <button type="button" className={button} onClick={onRefresh}>Refresh authoritative case</button> : null}
        {needsReview ? <button type="button" disabled={refreshing} onClick={() => { action.acknowledge(); setConfirmation(null); }} className={button}>I have reviewed the refreshed case</button> : null}
        {action.state.kind === "unauthorized" ? <Link href="/login" className="block text-sm underline">Sign in with decision permission</Link> : null}
      </div>
      {confirmation ? <dialog ref={dialog} aria-labelledby="decision-confirm-title" onCancel={event => { if (busy) event.preventDefault(); else setConfirmation(null); }} className="fixed inset-0 z-50 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-lg border bg-white p-5 shadow-xl backdrop:bg-stone-950/50">
        <form onSubmit={event => {
          event.preventDefault();
          if (busy || unresolved || needsReview || commandDisabledReason(data, confirmation.choice, confirmation.candidate)) return;
          if (confirmation.choice === "REJECT" && !note.trim()) { setNoteError("A rejection note is required."); return; }
          const meta = data.caseMeta!;
          const common = { schema_version: "3.0" as const, decision_case_id: data.caseStatus.decision_case_id,
            recommendation_id: data.recommendation.recommendation_id, expected_snapshot_id: data.snapshot.snapshot_id,
            expected_case_revision: meta.case_revision, expected_plan_version: meta.base_plan_version };
          const body: OperationsDecisionCommand = confirmation.choice === "REJECT"
            ? { ...common, command: "REJECT", note: note.trim() }
            : confirmation.choice === "COMMIT"
              ? { ...common, command: "COMMIT", candidate_plan_id: confirmation.candidate!.candidate_plan_id, candidate_version: confirmation.candidate!.plan_version }
              : { ...common, command: "APPROVE", candidate_plan_id: confirmation.candidate!.candidate_plan_id, candidate_version: confirmation.candidate!.plan_version, ...(note.trim() ? { note: note.trim() } : {}) };
          action.start(body);
        }} className="space-y-4">
          <h2 id="decision-confirm-title" className="text-lg font-semibold">Confirm {confirmation.choice.toLowerCase()}</h2>
          <p className="text-sm">{confirmation.choice === "COMMIT" ? "Publish the exact approved schedule to the factory. This advances the current plan version." : confirmation.choice === "APPROVE" ? "Record approval for the selected candidate. The current schedule will stay unchanged until you commit." : "Reject this recommendation package and record your reason."}</p>
          {confirmation.candidate ? <dl className="space-y-2 break-all text-xs" aria-label="Confirmation provenance">
            <div><dt>Candidate / version</dt><dd className="font-mono font-semibold">{confirmation.candidate.candidate_plan_id} · v{confirmation.candidate.plan_version}</dd></div>
            <div><dt>Engine</dt><dd>{confirmation.candidate.source_engine_id}@{confirmation.candidate.source_engine_version}</dd></div>
            <div><dt>Validation / validator / simulation runs</dt><dd>{confirmation.candidate.validation?.verdict} · {confirmation.candidate.validation?.validator_version} · {confirmation.candidate.validation?.simulation_runs ?? "Not provided"}</dd></div>
            <div><dt>Schedule</dt><dd>{confirmation.candidate.schedule.schedule_id} · revision {confirmation.candidate.schedule.revision}</dd></div>
          </dl> : null}
          {confirmation.choice !== "COMMIT" ? <label className="block text-xs font-semibold">Decision note {confirmation.choice === "REJECT" ? "(required)" : "(optional)"}<textarea aria-label="Decision note" rows={3} maxLength={4000} disabled={busy} value={note} onChange={event => setNote(event.target.value)} className="mt-1 block w-full rounded-md border p-3 text-sm" /></label> : null}
          {noteError ? <p role="alert" className="text-sm text-rose-800">{noteError}</p> : null}
          {action.busy ? <p role="status">Submitting decision…</p> : null}
          <div className="flex flex-wrap justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button type="submit" className={button} disabled={busy || unresolved || !!commandDisabledReason(data, confirmation.choice, confirmation.candidate)}>{busy ? "Submitting…" : `Confirm ${confirmation.choice.toLowerCase()}`}</button></div>
        </form>
      </dialog> : null}
    </OperationsPanel>
  );
}
