"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { OperationsPanel, OperationsShell } from "@/components/operations/operations-shell";
import { ScheduleGantt } from "@/components/operations/schedule-gantt";
import { AsyncState } from "@/components/research/async-state";
import {
  getOperationsApiClient,
  getOperationsApiMode,
  getOperationsFactoryId,
  useOperationsContext,
  type OperationsApiClient,
  type OperationsApiMode,
  type OperationsContextData,
} from "@/lib/operations-api";
import { formatDateTime } from "@/lib/operations/format";

function ContextValue({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4">
      <p className="text-xs text-[var(--color-ash-gray)]">{label}</p>
      <p className="mt-2 break-all font-mono text-sm font-semibold">{value}</p>
    </article>
  );
}

function ScheduleContext({ data }: { data: OperationsContextData }) {
  const schedule = data.scheduleResponse.schedule;
  const planningWindow = schedule?.planning_window ?? data.snapshotResponse.snapshot.planning_window;

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Schedule context">
      <ContextValue label="Snapshot ID" value={data.snapshotResponse.snapshot_id} />
      <ContextValue label="Plan version" value={String(data.snapshotResponse.plan_version)} />
      <ContextValue label="Schedule ID" value={schedule?.schedule_id ?? "Not provided"} />
      <ContextValue label="Schedule revision" value={schedule ? String(schedule.revision) : "Not provided"} />
      <ContextValue
        label="Planning window"
        value={`${formatDateTime(planningWindow.start_at)} – ${formatDateTime(planningWindow.end_at)}`}
      />
    </section>
  );
}

function CurrentSchedule({ data }: { data: OperationsContextData }) {
  const [machine, setMachine] = useState("");
  const [assignmentType, setAssignmentType] = useState("");
  const snapshot = data.snapshotResponse.snapshot;
  const schedule = data.scheduleResponse.schedule;
  const assignments = schedule?.assignments ?? [];

  return (
    <>
      <ScheduleContext data={data} />

      {!schedule ? (
        <AsyncState
          kind="empty"
          title="No current schedule"
          description="The snapshot is available, but the Current Schedule API returned no committed schedule."
        />
      ) : (
        <>
          <OperationsPanel title="Schedule filters" description="Filters change presentation only; they do not create a schedule revision.">
            <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
              <label className="text-xs font-semibold">
                Machine
                <select
                  aria-label="Filter schedule by machine"
                  value={machine}
                  onChange={(event) => setMachine(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"
                >
                  <option value="">All machines</option>
                  {snapshot.machines.map((item) => (
                    <option key={item.machine_id} value={item.machine_id}>{item.machine_id} · {item.display_name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Assignment type
                <select
                  aria-label="Filter schedule by assignment type"
                  value={assignmentType}
                  onChange={(event) => setAssignmentType(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"
                >
                  <option value="">All assignment types</option>
                  <option value="PRODUCTION">Production</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="BLOCKED_TIME">Blocked time</option>
                </select>
              </label>
            </div>
          </OperationsPanel>

          {!assignments.length ? (
            <AsyncState
              kind="empty"
              title="Current schedule has no assignments"
              description="The API returned schedule metadata, but its assignments collection is empty."
            />
          ) : (
            <OperationsPanel
              title="Current committed schedule"
              description="Machine and technician lanes come from the synchronized canonical payload. MachineRiskReport is not provided by these read APIs, so risk is shown as Not provided."
            >
              <ScheduleGantt
                schedule={schedule}
                snapshot={snapshot}
                label="Current plan"
                machineFilter={machine}
                assignmentTypeFilter={assignmentType}
              />
            </OperationsPanel>
          )}
        </>
      )}
    </>
  );
}

export function IntegratedSchedulePage({ api, factoryId, apiMode }: {
  api?: OperationsApiClient;
  factoryId?: string;
  apiMode?: OperationsApiMode;
} = {}) {
  const client = useMemo(() => api ?? getOperationsApiClient(), [api]);
  const selectedFactoryId = factoryId ?? getOperationsFactoryId();
  const selectedMode = apiMode ?? (api ? "mock" : getOperationsApiMode());
  const { state, retry } = useOperationsContext({ api: client, factoryId: selectedFactoryId });

  return (
    <OperationsShell
      title="Integrated Schedule / Gantt"
      description="The current committed schedule loaded with its synchronized factory snapshot through OperationsApiClient."
      dataSource={selectedMode === "real" ? "live" : "fixture"}
      actions={(
        <button
          type="button"
          onClick={retry}
          disabled={state.kind === "loading"}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />
          Refresh
        </button>
      )}
    >
      {state.kind === "loading" ? (
        <AsyncState
          kind="loading"
          title="Loading current schedule"
          description={`Requesting a synchronized snapshot and schedule for ${selectedFactoryId}.`}
        />
      ) : null}
      {state.kind === "unauthorized" ? (
        <AsyncState
          kind="error"
          title="Schedule access required"
          description={state.message}
          action={<Link href="/login" className="inline-flex min-h-10 items-center rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium">Sign in</Link>}
        />
      ) : null}
      {state.kind === "unavailable" ? (
        <AsyncState kind="empty" title="Operations snapshot unavailable" description={state.message} onRetry={retry} retryLabel="Retry schedule" />
      ) : null}
      {state.kind === "mismatch" ? (
        <AsyncState kind="error" title="Schedule version mismatch" description={state.message} onRetry={retry} retryLabel="Refresh context" />
      ) : null}
      {state.kind === "network-error" || state.kind === "error" ? (
        <AsyncState kind="error" title="Schedule data could not be loaded" description={state.message} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? <CurrentSchedule data={state.data} /> : null}
    </OperationsShell>
  );
}
