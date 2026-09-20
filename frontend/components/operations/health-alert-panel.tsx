import { AlertTriangle, Clock3, ExternalLink } from "lucide-react";

import { OperationsStatus } from "@/components/operations/operations-shell";
import { formatNumber, formatPercent, formatTime } from "@/lib/operations/format";
import type { MachineRiskReport } from "@/types/operations";

export interface HealthAlertPanelProps {
  reports: MachineRiskReport[];
}

export function HealthAlertPanel({ reports }: HealthAlertPanelProps) {
  if (!reports.length) return <p className="p-5 text-sm text-[var(--color-ash-gray)]">No active health alerts in this snapshot.</p>;
  return (
    <div className="divide-y divide-[var(--color-stone-border)]">
      {reports.map((report) => (
        <article key={report.risk_report_id} className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-amber-100 p-2 text-amber-700"><AlertTriangle className="h-4 w-4" /></span>
              <div><p className="font-mono text-sm font-semibold">{report.machine_id}</p><p className="mt-1 text-xs text-[var(--color-ash-gray)]">Report {report.risk_report_id}</p></div>
            </div>
            <OperationsStatus value={report.risk_level} />
          </div>
          <dl className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-[var(--color-ash-gray)]">Failure probability</dt><dd className="mt-1 text-lg font-semibold">{formatPercent(report.failure_probability)}</dd><p className="text-[11px] text-[var(--color-ash-gray)]">{report.prediction_horizon_minutes} min horizon</p></div>
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-[var(--color-ash-gray)]">Expected RUL</dt><dd className="mt-1 text-lg font-semibold">{formatNumber(report.expected_rul_minutes, " min")}</dd><p className="text-[11px] text-[var(--color-ash-gray)]">{report.confidence} confidence</p></div>
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-[var(--color-ash-gray)]">Review within</dt><dd className="mt-1 flex items-center gap-1.5 text-lg font-semibold"><Clock3 className="h-4 w-4" />{report.recommended_review_window_minutes} min</dd><p className="text-[11px] text-[var(--color-ash-gray)]">Generated {formatTime(report.generated_at)}</p></div>
          </dl>
          <div className="mt-4 space-y-2">{report.risk_drivers.map((driver) => <div key={driver.code} className="rounded-md border border-[var(--color-stone-border)] p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="font-mono text-xs">{driver.code}</strong>{driver.contribution !== undefined ? <span className="text-xs text-[var(--color-ash-gray)]">Returned contribution: {driver.contribution}</span> : null}</div><p className="mt-1 text-sm">{driver.description}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-ash-gray)]"><ExternalLink className="h-3 w-3" />Evidence: {driver.evidence_refs.join(", ")}</p></div>)}</div>
        </article>
      ))}
    </div>
  );
}
