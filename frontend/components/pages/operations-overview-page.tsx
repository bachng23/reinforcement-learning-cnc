import { CalendarClock, ClipboardList, UserRoundCheck } from "lucide-react";

import { HealthAlertPanel } from "@/components/operations/health-alert-panel";
import { MachineStatusGrid } from "@/components/operations/machine-status-grid";
import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { formatDateTime, formatTime } from "@/lib/operations/format";
import { getOperationsFixture } from "@/lib/operations/fixtures";

export function OperationsOverviewPage() {
  const fixture = getOperationsFixture();
  const snapshot = fixture.factory_snapshot;
  return (
    <OperationsShell title="Operations Overview" description="Shift-level factory context, health evidence, resource availability and decision cases from the immutable operations snapshot.">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Snapshot context">
        {[
          { label: "Factory", value: snapshot.factory_id, note: `Snapshot ${snapshot.snapshot_id}` },
          { label: "Captured", value: formatDateTime(snapshot.captured_at), note: "Immutable case input" },
          { label: "Planning window", value: `${formatTime(snapshot.planning_window.start_at)}–${formatTime(snapshot.planning_window.end_at)}`, note: "Returned TimeWindow" },
          { label: "Current schedule", value: snapshot.current_schedule ? `Revision ${snapshot.current_schedule.revision}` : "Not provided", note: snapshot.current_schedule?.schedule_id ?? "No schedule ID" },
        ].map((item) => <article key={item.label} className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4"><p className="text-xs text-[var(--color-ash-gray)]">{item.label}</p><p className="mt-2 break-words text-base font-semibold">{item.value}</p><p className="mt-1 break-all text-[11px] text-[var(--color-ash-gray)]">{item.note}</p></article>)}
      </section>

      <OperationsPanel title="Machine status grid" description="Machine, health and current assignment records are joined by ID; no health or progress value is inferred.">
        <MachineStatusGrid machines={snapshot.machines} healthSnapshots={snapshot.health_snapshots} assignments={snapshot.current_schedule?.assignments ?? []} />
      </OperationsPanel>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <OperationsPanel title="Health alert panel" description="PdM Agent reports, risk drivers and evidence references returned by MachineRiskReport.">
          <HealthAlertPanel reports={fixture.risk_reports} />
        </OperationsPanel>

        <div className="space-y-6">
          <OperationsPanel title="Decision cases requiring attention" description="Lifecycle status is backend authoritative.">
            <div className="divide-y divide-[var(--color-stone-border)]">{fixture.decision_cases.map((item) => <article key={item.decision_case_id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-semibold">{item.decision_case_id}</p><p className="mt-1 text-xs text-[var(--color-ash-gray)]">{item.trigger.type} · {item.trigger.machine_id}</p></div><OperationsStatus value={item.status} /></div><p className="mt-3 text-xs text-[var(--color-ash-gray)]">Updated {formatDateTime(item.updated_at)}</p></article>)}</div>
          </OperationsPanel>

          <OperationsPanel title="Technician availability" description="Direct Technician.status and availability windows.">
            <div className="divide-y divide-[var(--color-stone-border)]">{snapshot.technicians.map((tech) => <article key={tech.technician_id} className="flex items-start gap-3 p-4"><UserRoundCheck className="mt-0.5 h-4 w-4 text-sky-600" /><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{tech.display_name} <span className="font-mono text-xs font-normal text-[var(--color-ash-gray)]">{tech.technician_id}</span></p><OperationsStatus value={tech.status} /></div><p className="mt-1 text-xs text-[var(--color-ash-gray)]">{tech.skills.map((skill) => `${skill.skill_id} L${skill.level}`).join(" · ")}</p></div></article>)}</div>
          </OperationsPanel>
        </div>
      </div>

      <OperationsPanel title="Active maintenance work" description="Request priority, status and expected duration are supplied by FactorySnapshot.maintenance_requests.">
        <div className="grid gap-3 p-4 md:grid-cols-2 sm:p-5">{snapshot.maintenance_requests.map((request) => <article key={request.maintenance_request_id} className="rounded-md border border-[var(--color-stone-border)] p-4"><div className="flex flex-wrap justify-between gap-2"><p className="flex items-center gap-2 font-mono text-sm font-semibold"><ClipboardList className="h-4 w-4" />{request.maintenance_request_id}</p><OperationsStatus value={request.status} /></div><p className="mt-2 text-sm">{request.action_type} on <strong>{request.machine_id}</strong></p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ash-gray)]"><span>Priority: {request.priority}</span><span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{request.expected_duration_minutes} min</span><span>Required: {request.required_skill_ids.join(", ")}</span></div></article>)}</div>
      </OperationsPanel>

      <div className="rounded-md border border-dashed border-[var(--color-stone-border)] bg-white p-4 text-xs text-[var(--color-ash-gray)]">Shift KPI cards are intentionally deferred: contract v3 does not currently define an authoritative shift KPI payload. Candidate plan KPIs appear only in Recommendation Center.</div>
    </OperationsShell>
  );
}
