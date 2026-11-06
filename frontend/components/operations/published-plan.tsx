import Link from "next/link";
import { OperationsPanel } from "./operations-shell";
import { ScheduleGantt } from "./schedule-gantt";
import { candidateRejectionReason, recommendationPackageFailure } from "./recommendation-package-view";
import { AsyncState } from "@/components/research/async-state";
import { operationsHref } from "@/lib/operations-ui";
import { formatDateTime } from "@/lib/operations/format";
import type { RecommendationCenterStatusData } from "@/lib/recommendation-center";
import { PublicationWorkOrders } from "@/components/work-orders/publication-work-orders";

type ReadyData = Extract<RecommendationCenterStatusData, { artifactState: "ready" }>;

/** Verify identities only. Hashes/verdicts are authoritative; never recalculate them. */
export function publishedCandidate(data: ReadyData) {
  const meta = data.caseMeta;
  const commit = meta?.commit;
  const approved = meta?.approved_candidate;
  const candidate = data.recommendation.candidate_plans.find(plan => plan.candidate_plan_id === approved?.candidate_plan_id);
  if (data.caseStatus.status !== "COMMITTED" || !commit || !approved || !candidate
    || recommendationPackageFailure(data.recommendation, data.snapshot)
    || candidateRejectionReason(candidate, data.recommendation, data.snapshot)
    || data.caseStatus.decision_case_id !== data.recommendation.decision_case_id
    || commit.decision_case_id !== data.caseStatus.decision_case_id
    || commit.factory_id !== meta.factory_id || commit.factory_id !== data.snapshot.factory_id
    || commit.snapshot_id !== data.snapshot.snapshot_id || commit.snapshot_id !== data.caseStatus.snapshot_id
    || commit.schedule_id !== candidate.schedule.schedule_id || commit.schedule_revision !== candidate.schedule.revision
    || approved.candidate_version !== candidate.plan_version || approved.recommendation_id !== data.recommendation.recommendation_id
    || approved.schedule_hash !== commit.schedule_hash) return undefined;
  return candidate;
}

export function PublishedDecisionSchedule({ data, showGantt = true, assignmentId }: { data: ReadyData; showGantt?: boolean; assignmentId?: string }) {
  const candidate = publishedCandidate(data);
  const commit = data.caseMeta?.commit;
  if (!commit || !candidate) return <AsyncState kind="error" title="Published schedule context mismatch" description="Publication metadata does not match the immutable approved artifact. No replacement current-head schedule is shown." />;
  const scope = { demo: data.source === "mock-workflow" };
  return <OperationsPanel title="Published schedule" description="The exact approved artifact and its immutable basis. Current factory observations may have advanced since publication.">
    <div className="space-y-4 p-4 sm:p-5">
      <p role="status" className="break-words text-sm font-semibold text-emerald-800">Published plan version {commit.plan_version} · schedule <code className="break-all">{commit.schedule_id}</code> · revision {commit.schedule_revision}</p>
      <p className="break-all text-xs">Factory {commit.factory_id} · basis {commit.snapshot_id}<br />Committed by {commit.actor_id} at {formatDateTime(commit.committed_at)}</p>
      {data.caseMeta?.stale ? <p className="text-xs text-slate-500">The case is committed. A stale flag reflects the current head/basis comparison and does not undo this publication.</p> : null}
      {assignmentId ? <p className="break-all rounded border border-blue-200 bg-blue-50 p-3 text-sm">Selected source assignment: <code>{assignmentId}</code></p> : null}
      {showGantt ? <ScheduleGantt schedule={candidate.schedule} snapshot={data.snapshot} label={`Published plan ${commit.plan_version}`} highlightedAssignmentId={assignmentId} /> : null}
      {data.source === "real" && data.caseStatus.mode === "LIVE" ? <PublicationWorkOrders commit={commit} snapshot={data.snapshot} schedule={candidate.schedule} /> : null}
      <div className="flex flex-wrap gap-3 text-sm"><Link className="dss-secondary" href={operationsHref("/overview", commit.factory_id, scope)}>Open refreshed Overview</Link><Link className="dss-primary" href={operationsHref("/operations/schedule", commit.factory_id, { ...scope, caseId: commit.decision_case_id })}>Open this published Gantt</Link><Link className="underline text-blue-700" href={operationsHref("/operations/schedule", commit.factory_id, scope)}>Open current Gantt</Link></div>
    </div>
  </OperationsPanel>;
}
