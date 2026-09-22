"use client";

import { CalendarClock, ClipboardList, RefreshCw, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { HealthAlertPanel } from "@/components/operations/health-alert-panel";
import { MachineStatusGrid } from "@/components/operations/machine-status-grid";
import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { AsyncState } from "@/components/research/async-state";
import {
  getOperationsApiClient,
  getOperationsApiMode,
  getOperationsFactoryId,
  useOperationsContext,
  type OperationsContextData,
  type OperationsApiClient,
  type OperationsApiMode,
} from "@/lib/operations-api";
import { formatDateTime, formatTime } from "@/lib/operations/format";

function ResourceCount({ count, label, field }: { count: number; label: string; field: string }) {
  return (
    <article aria-label={`${count} ${label.toLowerCase()}`} className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4">
      <p className="text-xs text-[var(--color-ash-gray)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{count}</p>
      <p className="mt-1 font-mono text-[11px] text-[var(--color-ash-gray)]">{field}.length</p>
    </article>
  );
}

function OperationsOverviewContent({ data }: { data: OperationsContextData }) {
  const snapshot = data.snapshotResponse.snapshot;
  const schedule = data.scheduleResponse.schedule;
  const machines = snapshot.machines;
  const jobs = snapshot.jobs ?? [];
  const technicians = snapshot.technicians ?? [];
  const healthSnapshots = snapshot.health_snapshots ?? [];
  const maintenanceRequests = snapshot.maintenance_requests ?? [];
  const assignments = schedule?.assignments ?? [];

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Snapshot context">
        {[
          { label: "Factory", value: data.snapshotResponse.factory_id, note: `Snapshot ${data.snapshotResponse.snapshot_id}` },
          { label: "Captured", value: formatDateTime(data.snapshotResponse.captured_at), note: "Immutable case input" },
          { label: "Planning window", value: `${formatTime(snapshot.planning_window.start_at)}–${formatTime(snapshot.planning_window.end_at)}`, note: "Returned TimeWindow" },
          { label: "Current schedule", value: schedule ? `Revision ${schedule.revision}` : "Not provided", note: schedule?.schedule_id ?? "No current schedule ID" },
        ].map((item) => <article key={item.label} className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4"><p className="text-xs text-[var(--color-ash-gray)]">{item.label}</p><p className="mt-2 break-words text-base font-semibold">{item.value}</p><p className="mt-1 break-all text-[11px] text-[var(--color-ash-gray)]">{item.note}</p></article>)}
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Canonical resource counts">
        <ResourceCount count={machines.length} label="Machines" field="FactorySnapshot.machines" />
        <ResourceCount count={jobs.length} label="Jobs" field="FactorySnapshot.jobs" />
        <ResourceCount count={technicians.length} label="Technicians" field="FactorySnapshot.technicians" />
      </section>

      {!schedule ? <AsyncState kind="empty" compact title="No current schedule" description="The snapshot is available, but the Current Schedule API returned no committed schedule." /> : null}

      <OperationsPanel title="Machine status grid" description="Machine, health and current assignment records are joined by ID; no health or progress value is inferred.">
        <MachineStatusGrid machines={machines} healthSnapshots={healthSnapshots} assignments={assignments} />
      </OperationsPanel>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <OperationsPanel title="Health alert panel" description="Health index, failure probability, wear and optional RUL distribution are rendered directly from HealthSnapshot.">
          <HealthAlertPanel snapshots={healthSnapshots} />
        </OperationsPanel>

        <OperationsPanel title="Technician availability" description="Direct Technician.status, skills and availability from the snapshot.">
          <div className="divide-y divide-[var(--color-stone-border)]">{technicians.map((tech) => <article key={tech.technician_id} className="flex items-start gap-3 p-4"><UserRoundCheck className="mt-0.5 h-4 w-4 text-sky-600" /><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{tech.display_name} <span className="font-mono text-xs font-normal text-[var(--color-ash-gray)]">{tech.technician_id}</span></p><OperationsStatus value={tech.status} /></div><p className="mt-1 text-xs text-[var(--color-ash-gray)]">{tech.skills.map((skill) => `${skill.skill_id} L${skill.level}`).join(" · ")}</p><p className="mt-1 text-[11px] text-[var(--color-ash-gray)]">{(tech.availability ?? []).map((window) => `${formatTime(window.start_at)}–${formatTime(window.end_at)}`).join(", ") || "No availability window supplied"}</p></div></article>)}</div>
        </OperationsPanel>
      </div>

      <OperationsPanel title="Production jobs" description="All jobs and operation statuses come directly from FactorySnapshot.jobs; no progress percentage is calculated.">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-[var(--color-ash-gray)]"><tr><th className="px-4 py-3">Job</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Release / due</th><th className="px-4 py-3">Returned operations</th></tr></thead><tbody className="divide-y divide-[var(--color-stone-border)]">{jobs.map((job) => <tr key={job.job_id}><td className="px-4 py-3"><p className="font-mono font-semibold">{job.job_id}</p><p className="text-xs text-[var(--color-ash-gray)]">{job.display_name}</p></td><td className="px-4 py-3 font-semibold">{job.priority ?? "Not provided"}</td><td className="px-4 py-3 text-xs"><p>{formatDateTime(job.release_at)}</p><p className="mt-1 text-[var(--color-ash-gray)]">Due {formatDateTime(job.due_at)}</p></td><td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">{job.operations.map((operation) => <span key={operation.operation_id} className="rounded-full border bg-white px-2 py-1 font-mono text-[11px]">{operation.operation_id}: {operation.status ?? "Not provided"}</span>)}</div></td></tr>)}</tbody></table></div>
      </OperationsPanel>

      <OperationsPanel title="Active maintenance work" description="Request priority, status and expected duration are supplied by FactorySnapshot.maintenance_requests.">
        {maintenanceRequests.length ? <div className="grid gap-3 p-4 md:grid-cols-2 sm:p-5">{maintenanceRequests.map((request) => <article key={request.maintenance_request_id} className="rounded-md border border-[var(--color-stone-border)] p-4"><div className="flex flex-wrap justify-between gap-2"><p className="flex items-center gap-2 font-mono text-sm font-semibold"><ClipboardList className="h-4 w-4" />{request.maintenance_request_id}</p><OperationsStatus value={request.status} /></div><p className="mt-2 text-sm">{request.action_type} on <strong>{request.machine_id}</strong></p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ash-gray)]"><span>Priority: {request.priority}</span><span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{request.expected_duration_minutes} min</span><span>Required: {request.required_skill_ids.join(", ")}</span></div></article>)}</div> : <p className="p-5 text-sm text-[var(--color-ash-gray)]">No maintenance requests were supplied with this snapshot.</p>}
      </OperationsPanel>

      <div className="rounded-md border border-dashed border-[var(--color-stone-border)] bg-white p-4 text-xs text-[var(--color-ash-gray)]">No operational KPI or feasibility value is calculated in this page. Authoritative planning metrics remain backend-owned.</div>
    </>
  );
}

export function OperationsOverviewPage({ api, factoryId, apiMode }: {
  api?: OperationsApiClient;
  factoryId?: string;
  apiMode?: OperationsApiMode;
} = {}) {
  const client = useMemo(() => api ?? getOperationsApiClient(), [api]);
  const selectedFactoryId = factoryId ?? getOperationsFactoryId();
  const selectedMode = apiMode ?? (api ? "mock" : getOperationsApiMode());
  const { state, retry } = useOperationsContext({ api: client, factoryId: selectedFactoryId });
  const hasNoResources = state.kind === "ready" &&
    !state.data.snapshotResponse.snapshot.machines.length &&
    !(state.data.snapshotResponse.snapshot.jobs ?? []).length &&
    !(state.data.snapshotResponse.snapshot.technicians ?? []).length;

  return (
    <OperationsShell
      title="Operations Overview"
      description="Factory resources, health observations and the current schedule loaded through OperationsApiClient."
      dataSource={selectedMode === "real" ? "live" : "fixture"}
      actions={<button type="button" onClick={retry} disabled={state.kind === "loading"} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />Refresh</button>}
    >
      {state.kind === "loading" ? <AsyncState kind="loading" title="Loading operations snapshot" description={`Requesting snapshot and current schedule for ${selectedFactoryId}.`} /> : null}
      {hasNoResources ? <AsyncState kind="empty" title="No operations resources" description="The snapshot contains no machines, jobs or technicians." onRetry={retry} retryLabel="Refresh snapshot" /> : null}
      {state.kind === "unauthorized" ? <AsyncState kind="error" title="Operations access required" description={state.message} action={<Link href="/login" className="inline-flex min-h-10 items-center rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium">Sign in</Link>} /> : null}
      {state.kind === "unavailable" ? <AsyncState kind="empty" title="Operations snapshot unavailable" description={state.message} onRetry={retry} retryLabel="Retry snapshot" /> : null}
      {state.kind === "error" || state.kind === "network-error" || state.kind === "mismatch" ? <AsyncState kind="error" title="Operations data could not be loaded" description={state.message} onRetry={retry} /> : null}
      {state.kind === "ready" && !hasNoResources ? <OperationsOverviewContent data={state.data} /> : null}
    </OperationsShell>
  );
}
