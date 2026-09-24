import { CheckCircle2, DatabaseZap, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";

import { OperationsPanel, OperationsStatus } from "@/components/operations/operations-shell";
import { ScheduleGantt } from "@/components/operations/schedule-gantt";
import { AsyncState } from "@/components/research/async-state";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/operations/format";
import type {
  CandidatePlan,
  FactorySnapshot,
  PlanKPIs,
  RecommendationPackage,
} from "@/types/generated/operations";

export interface RecommendationPackageViewProps {
  recommendation: RecommendationPackage;
  snapshot: FactorySnapshot;
  selectedCandidateId: string;
  onSelectCandidate: (candidatePlanId: string) => void;
}

const KPI_ROWS: ReadonlyArray<{
  key: keyof PlanKPIs;
  label: string;
  format: (value: number | undefined) => string;
}> = [
  { key: "makespan_minutes", label: "Makespan", format: (value) => formatNumber(value, " min") },
  { key: "total_tardiness_minutes", label: "Total tardiness", format: (value) => formatNumber(value, " min") },
  { key: "maximum_tardiness_minutes", label: "Maximum tardiness", format: (value) => formatNumber(value, " min") },
  { key: "on_time_completion_rate", label: "On-time completion", format: formatPercent },
  { key: "expected_failure_count", label: "Expected failure count", format: formatNumber },
  { key: "failure_probability", label: "Failure probability", format: formatPercent },
  { key: "expected_emergency_downtime_minutes", label: "Expected emergency downtime", format: (value) => formatNumber(value, " min") },
  { key: "maintenance_cost", label: "Maintenance cost", format: formatNumber },
  { key: "technician_utilization", label: "Technician utilization", format: formatPercent },
  { key: "schedule_changes", label: "Schedule changes", format: formatNumber },
  { key: "decision_latency_ms", label: "Decision latency", format: (value) => formatNumber(value, " ms") },
];

export function candidateRejectionReason(
  candidate: CandidatePlan,
  recommendation: RecommendationPackage,
  snapshot: FactorySnapshot,
): string | undefined {
  if (candidate.snapshot_id !== recommendation.snapshot_id || candidate.snapshot_id !== snapshot.snapshot_id) {
    return "Candidate snapshot does not match the authoritative package snapshot.";
  }
  if (candidate.decision_case_id !== recommendation.decision_case_id) {
    return "Candidate decision case does not match the recommendation package.";
  }
  if (candidate.schedule.factory_id !== snapshot.factory_id) {
    return "Candidate schedule factory does not match the authoritative snapshot.";
  }
  if (!candidate.validation) return "Validation payload is missing.";
  if (candidate.validation.candidate_plan_id !== candidate.candidate_plan_id) {
    return "Validation references a different candidate.";
  }
  if (candidate.validation.verdict !== "VALID") {
    return `Validation verdict is ${candidate.validation.verdict}.`;
  }
  return undefined;
}

export function isSelectableRecommendationCandidate(
  candidate: CandidatePlan,
  recommendation: RecommendationPackage,
  snapshot: FactorySnapshot,
): boolean {
  return candidateRejectionReason(candidate, recommendation, snapshot) === undefined;
}

function packageFailure(
  recommendation: RecommendationPackage,
  snapshot: FactorySnapshot,
): string | undefined {
  if (recommendation.snapshot_id !== snapshot.snapshot_id) {
    return "RecommendationPackage.snapshot_id does not match FactorySnapshot.snapshot_id.";
  }
  if (recommendation.candidate_plans.length < 1 || recommendation.candidate_plans.length > 5) {
    return "RecommendationPackage must contain between 1 and 5 candidates.";
  }
  const recommended = recommendation.candidate_plans.find(
    (candidate) => candidate.candidate_plan_id === recommendation.recommended_plan_id,
  );
  if (!recommended) return "The recommended candidate is not present in candidate_plans.";
  const reason = candidateRejectionReason(recommended, recommendation, snapshot);
  if (reason) return `The recommended candidate was rejected. ${reason}`;
  return undefined;
}

function TextList({ items, emptyLabel = "None returned" }: { items: readonly string[] | undefined; emptyLabel?: string }) {
  return items?.length ? (
    <ul className="mt-2 space-y-1 text-sm text-[var(--color-ash-gray)]">
      {items.map((item) => <li key={item} className="break-words">• {item}</li>)}
    </ul>
  ) : <p className="mt-2 text-sm text-[var(--color-ash-gray)]">{emptyLabel}</p>;
}

export function RecommendationPackageView({
  recommendation,
  snapshot,
  selectedCandidateId,
  onSelectCandidate,
}: RecommendationPackageViewProps) {
  const failure = packageFailure(recommendation, snapshot);
  if (failure) {
    return (
      <AsyncState
        kind="error"
        title="Recommendation package mismatch"
        description={`${failure} Candidate data is hidden to prevent mixed-context decisions.`}
      />
    );
  }

  const selectable = recommendation.candidate_plans.filter((candidate) =>
    isSelectableRecommendationCandidate(candidate, recommendation, snapshot));
  const rejected = recommendation.candidate_plans.flatMap((candidate) => {
    const reason = candidateRejectionReason(candidate, recommendation, snapshot);
    return reason ? [{ candidate, reason }] : [];
  });
  const recommended = selectable.find((candidate) => candidate.candidate_plan_id === recommendation.recommended_plan_id)!;
  const selected = selectable.find((candidate) => candidate.candidate_plan_id === selectedCandidateId) ?? recommended;
  const explanation = recommendation.explanation;
  const assignments = selected.schedule.assignments ?? [];

  return (
    <>
      <OperationsPanel title="Why this recommendation?" description="Explanation and evidence are rendered directly from RecommendationPackage.explanation.">
        <div className="p-4 sm:p-5">
          <p className="max-w-4xl text-sm leading-6">{explanation.summary}</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div><h3 className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">Primary reasons</h3><TextList items={explanation.primary_reasons} /></div>
            <div><h3 className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">Tradeoffs</h3><TextList items={explanation.tradeoffs} /></div>
            <div><h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--color-ash-gray)]"><ShieldAlert className="h-3.5 w-3.5" />Residual risks</h3><TextList items={explanation.residual_risks} /></div>
          </div>
          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">Evidence references</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {explanation.evidence_refs.map((reference) => <code key={reference} className="max-w-full break-all rounded bg-stone-100 px-2 py-1 text-xs">{reference}</code>)}
            </div>
          </div>
        </div>
      </OperationsPanel>

      <OperationsPanel title="Candidate comparison" description="Only backend-validated candidates are selectable. The frontend does not rank candidates or calculate KPI deltas.">
        <div className="p-4 sm:p-5">
          <div className="overflow-x-auto pb-2" aria-label="Candidate selector">
            <div className="grid min-w-max auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3">
              {selectable.map((candidate) => (
                <button
                  key={candidate.candidate_plan_id}
                  type="button"
                  onClick={() => onSelectCandidate(candidate.candidate_plan_id)}
                  aria-pressed={selected.candidate_plan_id === candidate.candidate_plan_id}
                  className={`min-w-0 rounded-md border p-3 text-left ${selected.candidate_plan_id === candidate.candidate_plan_id ? "border-sky-400 bg-sky-50 ring-1 ring-sky-300" : "border-[var(--color-stone-border)] bg-white"}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{candidate.strategy.replaceAll("_", " ")}</span>
                    {candidate.candidate_plan_id === recommendation.recommended_plan_id ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">RECOMMENDED</span> : null}
                  </span>
                  <span className="mt-2 block break-all font-mono text-[11px] text-[var(--color-ash-gray)]">{candidate.candidate_plan_id}</span>
                  <span className="mt-1 block break-all text-xs text-[var(--color-ash-gray)]">Plan v{candidate.plan_version} · {candidate.source_engine_id}@{candidate.source_engine_version}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="my-4 text-xs text-[var(--color-ash-gray)]">Every value below comes directly from <code>CandidatePlan.kpis</code>.</p>
          <div className="overflow-x-auto rounded-md border border-[var(--color-stone-border)]" data-testid="candidate-kpi-scroll">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-stone-50"><tr><th className="px-3 py-3 text-xs uppercase text-[var(--color-ash-gray)]">Returned KPI</th>{selectable.map((candidate) => <th key={candidate.candidate_plan_id} className={`px-3 py-3 align-top ${selected.candidate_plan_id === candidate.candidate_plan_id ? "bg-sky-50" : ""}`}><span className="block break-all font-mono text-[11px]">{candidate.candidate_plan_id}</span><span className="mt-1 block text-xs font-normal text-[var(--color-ash-gray)]">{candidate.strategy.replaceAll("_", " ")} · v{candidate.plan_version}</span></th>)}</tr></thead>
              <tbody className="divide-y divide-[var(--color-stone-border)]">{KPI_ROWS.map((row) => <tr key={row.key}><th className="px-3 py-2 text-xs font-medium text-[var(--color-ash-gray)]">{row.label}</th>{selectable.map((candidate) => <td key={candidate.candidate_plan_id} data-selected={selected.candidate_plan_id === candidate.candidate_plan_id || undefined} className={`px-3 py-2 font-semibold ${selected.candidate_plan_id === candidate.candidate_plan_id ? "bg-sky-50" : ""}`}>{row.format(candidate.kpis[row.key] ?? undefined)}</td>)}</tr>)}</tbody>
            </table>
          </div>

          {rejected.length ? (
            <section className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-4" aria-label="Rejected candidates">
              <h3 className="text-sm font-semibold text-rose-900">Rejected candidates</h3>
              <ul className="mt-2 space-y-2 text-xs text-rose-800">
                {rejected.map(({ candidate, reason }) => <li key={candidate.candidate_plan_id}><code className="break-all">{candidate.candidate_plan_id}</code>: {reason}</li>)}
              </ul>
            </section>
          ) : null}
        </div>
      </OperationsPanel>

      <OperationsPanel title="Selected candidate provenance" description="Strategy, version and engine fields are returned by the selected CandidatePlan.">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <div><p className="text-xs text-[var(--color-ash-gray)]">Candidate</p><p className="mt-1 break-all font-mono text-sm font-semibold">{selected.candidate_plan_id}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Strategy / plan version</p><p className="mt-1 text-sm font-semibold">{selected.strategy} · v{selected.plan_version}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Source engine</p><p className="mt-1 break-all font-mono text-sm font-semibold">{selected.source_engine_id}@{selected.source_engine_version}</p></div>
          <div><p className="text-xs text-[var(--color-ash-gray)]">Generated</p><p className="mt-1 text-sm font-semibold">{formatDateTime(selected.generated_at)}</p></div>
          <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs text-[var(--color-ash-gray)]">Source agent runs</p><p className="mt-1 break-all font-mono text-xs">{selected.source_agent_run_ids?.join(", ") || "Not provided"}</p></div>
        </div>
      </OperationsPanel>

      <div className="grid gap-6 lg:grid-cols-3">
        <OperationsPanel title="Validation" className="min-w-0">
          <div className="p-4 sm:p-5">
            <p className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-600" />Authoritative verdict</p>
            <div className="mt-3"><OperationsStatus value={selected.validation!.verdict} /></div>
            <dl className="mt-3 space-y-2 text-xs"><div><dt className="text-[var(--color-ash-gray)]">Validator</dt><dd className="break-all font-mono font-semibold">{selected.validation!.validator_version}</dd></div><div><dt className="text-[var(--color-ash-gray)]">Simulation runs</dt><dd className="font-semibold">{selected.validation!.simulation_runs ?? "Not provided"}</dd></div></dl>
          </div>
        </OperationsPanel>
        <OperationsPanel title="Assumptions" className="min-w-0">
          <div className="p-4 sm:p-5"><p className="flex items-center gap-2 text-xs font-semibold"><CheckCircle2 className="h-4 w-4 text-sky-600" />Returned assumptions</p><TextList items={selected.assumptions} /></div>
        </OperationsPanel>
        <OperationsPanel title="Warnings" className="min-w-0">
          <div className="p-4 sm:p-5"><p className="flex items-center gap-2 text-xs font-semibold"><TriangleAlert className="h-4 w-4 text-amber-600" />Returned warnings</p><TextList items={selected.warnings} /></div>
        </OperationsPanel>
      </div>

      <OperationsPanel title="Selected candidate Gantt" description="Schedule assignments are rendered directly from the selected CandidatePlan.schedule.">
        {assignments.length ? (
          <ScheduleGantt schedule={selected.schedule} snapshot={snapshot} label={`${selected.strategy} · ${selected.candidate_plan_id}`} />
        ) : (
          <AsyncState kind="empty" compact title="Selected candidate has no assignments" description="The backend returned an empty assignments collection for this candidate schedule." />
        )}
      </OperationsPanel>

      <div role="note" className="flex items-start gap-2 rounded-md border border-dashed border-[var(--color-stone-border)] bg-white p-4 text-xs text-[var(--color-ash-gray)]">
        <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0" />
        KPI, validation, explanation, evidence and schedule values are displayed as returned. The frontend does not rank candidates or derive KPI, feasibility, risk or evidence.
      </div>
    </>
  );
}
