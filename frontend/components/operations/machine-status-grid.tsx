import { Activity, Clock3, Wrench } from "lucide-react";

import { OperationsStatus } from "@/components/operations/operations-shell";
import { formatPercent, formatTime } from "@/lib/operations/format";
import type { HealthSnapshot, Machine, ScheduleAssignment } from "@/types/operations";

export interface MachineStatusGridProps {
  machines: Machine[];
  healthSnapshots: HealthSnapshot[];
  assignments: ScheduleAssignment[];
}

export function MachineStatusGrid({ machines, healthSnapshots, assignments }: MachineStatusGridProps) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 sm:p-5">
      {machines.map((machine) => {
        const health = healthSnapshots.find((item) => item.machine_id === machine.machine_id);
        const assignment = assignments.find((item) => item.machine_id === machine.machine_id && item.status === "RUNNING")
          ?? assignments.find((item) => item.machine_id === machine.machine_id);
        const work = assignment?.operation_id ?? assignment?.maintenance_request_id ?? assignment?.assignment_id;
        return (
          <article key={machine.machine_id} className="rounded-lg border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-[var(--color-ash-gray)]">{machine.machine_id}</p>
                <h3 className="mt-1 truncate text-sm font-semibold">{machine.display_name}</h3>
              </div>
              <OperationsStatus value={machine.status} />
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-1.5 text-[var(--color-ash-gray)]"><Activity className="h-3.5 w-3.5" />Health index</dt><dd className="font-semibold">{formatPercent(health?.health_index)}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-[var(--color-ash-gray)]">Failure probability</dt><dd className="font-semibold">{formatPercent(health?.failure_probability)}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-1.5 text-[var(--color-ash-gray)]"><Wrench className="h-3.5 w-3.5" />Current work</dt><dd className="font-mono font-semibold">{work ?? "None"}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-1.5 text-[var(--color-ash-gray)]"><Clock3 className="h-3.5 w-3.5" />Window</dt><dd>{assignment ? `${formatTime(assignment.start_at)}–${formatTime(assignment.end_at)}` : "Not scheduled"}</dd></div>
            </dl>
            <p className="mt-3 border-t border-[var(--color-stone-border)] pt-3 text-[11px] text-[var(--color-ash-gray)]">{health ? `${health.confidence} confidence · ${health.source_model_version}` : "Health snapshot not provided"}</p>
          </article>
        );
      })}
    </div>
  );
}
