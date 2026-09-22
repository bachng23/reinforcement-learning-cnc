import { Activity, Clock3, Wrench } from "lucide-react";

import { OperationsStatus } from "@/components/operations/operations-shell";
import { formatNumber, formatPercent, formatTime } from "@/lib/operations/format";
import type { HealthSnapshot } from "@/types/generated/operations";

export interface HealthAlertPanelProps {
  snapshots: HealthSnapshot[];
}

/** Displays authoritative health observations only; it does not infer risk or RUL. */
export function HealthAlertPanel({ snapshots }: HealthAlertPanelProps) {
  if (!snapshots.length) {
    return <p className="p-5 text-sm text-[var(--color-ash-gray)]">No health observations were supplied with this snapshot.</p>;
  }

  return (
    <div className="divide-y divide-[var(--color-stone-border)]">
      {snapshots.map((snapshot) => (
        <article key={snapshot.health_snapshot_id} className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-amber-100 p-2 text-amber-700"><Activity className="h-4 w-4" /></span>
              <div><p className="font-mono text-sm font-semibold">{snapshot.machine_id}</p><p className="mt-1 text-xs text-[var(--color-ash-gray)]">Observation {snapshot.health_snapshot_id}</p></div>
            </div>
            <OperationsStatus value={`${snapshot.confidence} CONFIDENCE`} />
          </div>

          <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-[var(--color-ash-gray)]">Health index</dt><dd className="mt-1 text-lg font-semibold">{formatPercent(snapshot.health_index)}</dd></div>
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-[var(--color-ash-gray)]">Failure probability</dt><dd className="mt-1 text-lg font-semibold">{formatPercent(snapshot.failure_probability)}</dd><p className="text-[11px] text-[var(--color-ash-gray)]">{snapshot.failure_probability_horizon_minutes} min horizon</p></div>
            <div className="rounded-md bg-stone-50 p-3"><dt className="flex items-center gap-1.5 text-xs text-[var(--color-ash-gray)]"><Wrench className="h-3.5 w-3.5" />Observed wear</dt><dd className="mt-1 text-lg font-semibold">{formatNumber(snapshot.observed_wear_um ?? undefined, " µm")}</dd></div>
            <div className="rounded-md bg-stone-50 p-3"><dt className="flex items-center gap-1.5 text-xs text-[var(--color-ash-gray)]"><Clock3 className="h-3.5 w-3.5" />Observed</dt><dd className="mt-1 text-lg font-semibold">{formatTime(snapshot.observed_at)}</dd></div>
          </dl>

          <div className="mt-4 rounded-md border border-[var(--color-stone-border)] p-3 text-xs">
            <p><span className="text-[var(--color-ash-gray)]">Source model:</span> <span className="font-mono font-semibold">{snapshot.source_model_version}</span></p>
            {snapshot.rul_distribution ? <p className="mt-2 text-[var(--color-ash-gray)]">Returned RUL support: {snapshot.rul_distribution.support_minutes.join(", ")} min · survival beyond horizon {formatPercent(snapshot.rul_distribution.survival_beyond_horizon)}</p> : <p className="mt-2 text-[var(--color-ash-gray)]">RUL distribution not provided. The frontend does not derive one.</p>}
          </div>
        </article>
      ))}
    </div>
  );
}
