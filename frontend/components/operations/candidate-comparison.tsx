import { CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";

import { OperationsStatus } from "@/components/operations/operations-shell";
import { formatNumber, formatPercent } from "@/lib/operations/format";
import type { CandidatePlan } from "@/types/operations";

export interface CandidateComparisonProps {
  candidates: CandidatePlan[];
  recommendedPlanId: string;
  selectedPlanId: string;
  onSelect: (candidatePlanId: string) => void;
}

const KPI_ROWS: Array<{ key: keyof CandidatePlan["kpis"]; label: string; format: (value: number | undefined) => string }> = [
  { key: "makespan_minutes", label: "Makespan", format: (value) => formatNumber(value, " min") },
  { key: "total_tardiness_minutes", label: "Total tardiness", format: (value) => formatNumber(value, " min") },
  { key: "maximum_tardiness_minutes", label: "Maximum tardiness", format: (value) => formatNumber(value, " min") },
  { key: "on_time_completion_rate", label: "On-time completion", format: formatPercent },
  { key: "expected_failure_count", label: "Expected failure count", format: formatNumber },
  { key: "failure_probability", label: "Failure probability", format: formatPercent },
  { key: "expected_emergency_downtime_minutes", label: "Expected emergency downtime", format: (value) => formatNumber(value, " min") },
  { key: "maintenance_cost", label: "Maintenance cost", format: (value) => formatNumber(value) },
  { key: "technician_utilization", label: "Technician utilization", format: formatPercent },
  { key: "schedule_changes", label: "Schedule changes", format: formatNumber },
  { key: "decision_latency_ms", label: "Decision latency", format: (value) => formatNumber(value, " ms") },
];

export function CandidateComparison({ candidates, recommendedPlanId, selectedPlanId, onSelect }: CandidateComparisonProps) {
  const selected = candidates.find((candidate) => candidate.candidate_plan_id === selectedPlanId) ?? candidates[0];
  return (
    <div className="p-4 sm:p-5">
      <p className="mb-4 text-xs text-[var(--color-ash-gray)]">Every KPI below is displayed directly from <code>CandidatePlan.kpis</code>. The frontend does not rank candidates or calculate deltas.</p>
      <div className="overflow-x-auto rounded-md border border-[var(--color-stone-border)]">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-stone-50"><tr><th className="px-3 py-3 text-xs uppercase text-[var(--color-ash-gray)]">Returned KPI</th>{candidates.map((candidate) => <th key={candidate.candidate_plan_id} className="px-3 py-3 align-top"><button type="button" onClick={() => onSelect(candidate.candidate_plan_id)} aria-pressed={selectedPlanId === candidate.candidate_plan_id} className={`w-full rounded-md border p-3 text-left ${selectedPlanId === candidate.candidate_plan_id ? "border-sky-400 bg-sky-50 ring-1 ring-sky-300" : "border-[var(--color-stone-border)] bg-white"}`}><span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{candidate.strategy.replaceAll("_", " ")}</span>{candidate.candidate_plan_id === recommendedPlanId ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">RECOMMENDED</span> : null}</span><span className="mt-1 block font-mono text-[11px] text-[var(--color-ash-gray)]">{candidate.candidate_plan_id} · v{candidate.plan_version}</span></button></th>)}</tr></thead>
          <tbody className="divide-y divide-[var(--color-stone-border)]">{KPI_ROWS.map((row) => <tr key={row.key}><th className="px-3 py-2 text-xs font-medium text-[var(--color-ash-gray)]">{row.label}</th>{candidates.map((candidate) => <td key={candidate.candidate_plan_id} className="px-3 py-2 font-semibold">{row.format(candidate.kpis[row.key])}</td>)}</tr>)}</tbody>
        </table>
      </div>

      {selected ? <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-[var(--color-stone-border)] p-3"><p className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-600" />Validation</p><div className="mt-2"><OperationsStatus value={selected.validation?.verdict ?? "NOT_VALIDATED"} /></div><p className="mt-2 text-xs text-[var(--color-ash-gray)]">{selected.validation ? `${selected.validation.simulation_runs} simulation runs · ${selected.validation.validator_version}` : "No validation payload"}</p></div>
        <div className="rounded-md border border-[var(--color-stone-border)] p-3"><p className="flex items-center gap-2 text-xs font-semibold"><CheckCircle2 className="h-4 w-4 text-sky-600" />Assumptions</p><ul className="mt-2 space-y-1 text-xs text-[var(--color-ash-gray)]">{selected.assumptions.length ? selected.assumptions.map((item) => <li key={item}>• {item}</li>) : <li>None returned</li>}</ul></div>
        <div className="rounded-md border border-[var(--color-stone-border)] p-3"><p className="flex items-center gap-2 text-xs font-semibold"><TriangleAlert className="h-4 w-4 text-amber-600" />Warnings</p><ul className="mt-2 space-y-1 text-xs text-[var(--color-ash-gray)]">{selected.warnings.length ? selected.warnings.map((item) => <li key={item}>• {item}</li>) : <li>None returned</li>}</ul></div>
      </div> : null}
    </div>
  );
}
