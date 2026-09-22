import { OperationsStatus } from "@/components/operations/operations-shell";
import { formatTime } from "@/lib/operations/format";
import type { FactorySnapshot, MachineRiskReport, Schedule, ScheduleAssignment } from "@/types/operations";

export interface ScheduleGanttProps {
  schedule: Schedule;
  snapshot: FactorySnapshot;
  riskReports: MachineRiskReport[];
  label: string;
  machineFilter?: string;
  assignmentTypeFilter?: string;
}

const blockTone: Record<ScheduleAssignment["assignment_type"], string> = {
  PRODUCTION: "border-sky-300 bg-sky-100 text-sky-950",
  MAINTENANCE: "border-amber-300 bg-amber-100 text-amber-950",
  BLOCKED_TIME: "border-stone-300 bg-stone-200 text-stone-800",
};

function assignmentContext(assignment: ScheduleAssignment, snapshot: FactorySnapshot, risks: MachineRiskReport[]) {
  const request = snapshot.maintenance_requests.find((item) => item.maintenance_request_id === assignment.maintenance_request_id);
  const job = snapshot.jobs.find((item) => item.job_id === assignment.job_id);
  const operation = job?.operations.find((item) => item.operation_id === assignment.operation_id);
  const risk = risks.find((item) => item.machine_id === assignment.machine_id);
  return {
    task: assignment.operation_id ?? assignment.maintenance_request_id ?? assignment.assignment_id,
    priority: request?.priority ?? (job ? String(job.priority) : "Not provided"),
    dependencies: operation?.predecessor_operation_ids.length ? operation.predecessor_operation_ids.join(", ") : "None returned",
    risk: risk?.risk_level ?? "Not provided",
  };
}

export function ScheduleGantt({ schedule, snapshot, riskReports, label, machineFilter = "", assignmentTypeFilter = "" }: ScheduleGanttProps) {
  const start = new Date(schedule.planning_window.start_at).getTime();
  const end = new Date(schedule.planning_window.end_at).getTime();
  const span = Math.max(1, end - start);
  const included = schedule.assignments.filter((assignment) =>
    (!machineFilter || assignment.machine_id === machineFilter) &&
    (!assignmentTypeFilter || assignment.assignment_type === assignmentTypeFilter));
  const machines = snapshot.machines.filter((machine) => !machineFilter || machine.machine_id === machineFilter);
  const technicians = snapshot.technicians.filter((technician) => included.some((assignment) => assignment.technician_ids.includes(technician.technician_id)));
  const position = (value: string) => Math.max(0, Math.min(100, ((new Date(value).getTime() - start) / span) * 100));
  const ticks = Array.from({ length: 5 }, (_, index) => new Date(start + (span * index) / 4).toISOString());

  const lane = (key: string, title: string, assignments: ScheduleAssignment[]) => (
    <div key={key} className="grid min-h-14 grid-cols-[120px_1fr] border-t border-[var(--color-stone-border)]">
      <div className="flex items-center border-r border-[var(--color-stone-border)] bg-stone-50 px-3 font-mono text-xs font-semibold">{title}</div>
      <div className="relative min-w-[720px] bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px)] bg-[size:25%_100%]">
        {assignments.map((assignment) => {
          const left = position(assignment.start_at);
          const right = position(assignment.end_at);
          const context = assignmentContext(assignment, snapshot, riskReports);
          return (
            <div
              key={`${key}:${assignment.assignment_id}`}
              className={`absolute top-2 h-10 overflow-hidden rounded-md border px-2 py-1 text-[11px] shadow-sm ${blockTone[assignment.assignment_type]} ${assignment.status === "PROPOSED" ? "border-dashed ring-1 ring-inset ring-white" : ""}`}
              style={{ left: `${left}%`, width: `${Math.max(3, right - left)}%` }}
              title={`${context.task} · ${formatTime(assignment.start_at)}–${formatTime(assignment.end_at)} · ${assignment.status} · priority ${context.priority} · risk ${context.risk} · dependencies ${context.dependencies} · revision ${schedule.revision}`}
            >
              <p className="truncate font-semibold">{context.task}</p><p className="truncate opacity-75">{formatTime(assignment.start_at)}–{formatTime(assignment.end_at)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">{label}</h3><p className="mt-1 text-xs text-[var(--color-ash-gray)]">Schedule {schedule.schedule_id} · authoritative revision {schedule.revision}</p></div>
        <div className="flex flex-wrap gap-2 text-[11px]"><span className="rounded border border-sky-200 bg-sky-50 px-2 py-1">Production</span><span className="rounded border border-amber-200 bg-amber-50 px-2 py-1">Maintenance</span><span className="rounded border border-stone-200 bg-stone-100 px-2 py-1">Blocked</span></div>
      </div>
      <div className="overflow-x-auto rounded-md border border-[var(--color-stone-border)]">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-[120px_1fr] bg-stone-50 text-[11px] text-[var(--color-ash-gray)]"><div className="border-r p-2">Resource lane</div><div className="flex justify-between px-2 py-2">{ticks.map((tick) => <span key={tick}>{formatTime(tick)}</span>)}</div></div>
          <div className="bg-stone-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">Machines</div>
          {machines.map((machine) => lane(`machine-${machine.machine_id}`, machine.machine_id, included.filter((assignment) => assignment.machine_id === machine.machine_id)))}
          {technicians.length ? <div className="bg-stone-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">Technicians</div> : null}
          {technicians.map((technician) => lane(`tech-${technician.technician_id}`, technician.technician_id, included.filter((assignment) => assignment.technician_ids.includes(technician.technician_id))))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="text-[var(--color-ash-gray)]"><tr><th className="pb-2">Task</th><th className="pb-2">Resource</th><th className="pb-2">Window</th><th className="pb-2">Status</th><th className="pb-2">Risk / priority</th><th className="pb-2">Dependencies</th></tr></thead>
          <tbody className="divide-y divide-[var(--color-stone-border)]">{included.map((assignment) => { const context = assignmentContext(assignment, snapshot, riskReports); return <tr key={assignment.assignment_id}><td className="py-2 font-mono font-semibold">{context.task}</td><td className="py-2">{assignment.machine_id}{assignment.technician_ids.length ? ` · ${assignment.technician_ids.join(", ")}` : ""}</td><td className="py-2">{formatTime(assignment.start_at)}–{formatTime(assignment.end_at)}</td><td className="py-2"><OperationsStatus value={assignment.status} /></td><td className="py-2">{context.risk} / {context.priority}</td><td className="py-2">{context.dependencies}</td></tr>; })}</tbody>
        </table>
      </div>
      {!included.length ? <p className="mt-4 rounded-md bg-stone-50 p-4 text-sm text-[var(--color-ash-gray)]">No assignments match the selected filters.</p> : null}
    </div>
  );
}
