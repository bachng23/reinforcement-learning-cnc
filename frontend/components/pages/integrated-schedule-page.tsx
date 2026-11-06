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
import { operationsUiClient } from "@/lib/operations-ui";
import { createRealRecommendationCenterDataSource, useRecommendationCenter } from "@/lib/recommendation-center";
import { PublishedDecisionSchedule, publishedCandidate } from "@/components/operations/published-plan";

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
      <ContextValue label="Observation snapshot ID" value={data.snapshotResponse.snapshot_id} />
      <ContextValue label="Plan version" value={String(data.snapshotResponse.plan_version)} />
      <ContextValue label="Schedule ID" value={schedule?.schedule_id ?? "Not provided"} />
      <ContextValue label="Schedule revision" value={schedule ? String(schedule.revision) : "Not provided"} />
      <ContextValue label="Published basis snapshot ID" value={data.scheduleResponse.basis_snapshot?.snapshot_id ?? "Not provided"} />
      <ContextValue
        label="Planning window"
        value={`${formatDateTime(planningWindow.start_at)} – ${formatDateTime(planningWindow.end_at)}`}
      />
    </section>
  );
}

export function CurrentSchedule({ data }: { data: OperationsContextData }) {
  const [machine, setMachine] = useState("");
  const [assignmentType, setAssignmentType] = useState("");
  const snapshot = data.scheduleResponse.basis_snapshot;
  const schedule = data.scheduleResponse.schedule;
  const assignments = schedule?.assignments ?? [];
  const commit = data.scheduleResponse.commit;
  const mismatch = schedule && snapshot && (schedule.factory_id !== snapshot.factory_id
    || snapshot.factory_id !== data.scheduleResponse.factory_id || snapshot.factory_id !== data.snapshotResponse.factory_id
    || (commit && (commit.factory_id !== snapshot.factory_id || commit.snapshot_id !== snapshot.snapshot_id
      || commit.schedule_id !== schedule.schedule_id || commit.schedule_revision !== schedule.revision || commit.plan_version !== data.scheduleResponse.plan_version)));

  return (
    <>
      <ScheduleContext data={data} />

      {!schedule ? (
        <AsyncState
          kind="empty"
          title="No current schedule"
          description="The snapshot is available, but the Current Schedule API returned no committed schedule."
        />
      ) : mismatch ? (
        <AsyncState kind="error" title="Published schedule context mismatch" description="The schedule, immutable basis and publication identities do not agree. No assignments are rendered." />
      ) : !snapshot ? (
        <AsyncState kind="error" title="Schedule basis unavailable" description="The data used to publish this schedule is unavailable. Refresh to try again." />
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
              description="Lanes, priorities and dependencies reflect the data used when this schedule was published. MachineRiskReport is not provided by these read APIs, so risk is shown as Not provided."
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

export type PublishedSourceHint = { scheduleId: string; revision: string; assignmentId: string };
function CasePublishedSchedule({ api, factoryId, caseId, mode, sourceHint }: { api: OperationsApiClient; factoryId?: string; caseId: string; mode: OperationsApiMode; sourceHint?: PublishedSourceHint }) {
  // Existing case/artifact read endpoints recover the exact published plan.
  // There is no historical-current-schedule endpoint or fabricated selector.
  const source = useMemo(() => createRealRecommendationCenterDataSource(api), [api]);
  const { state, refresh, refreshing } = useRecommendationCenter({ dataSource: source, caseId });
  const data = state.kind === "ready" && state.data.source !== "mock" ? state.data : null;
  const factoryMatches = data?.caseMeta?.factory_id && (!factoryId || data.caseMeta.factory_id === factoryId);
  const candidate = data?.artifactState === "ready" ? publishedCandidate(data) : undefined;
  const sourceMatches = !sourceHint || (candidate && candidate.schedule.schedule_id === sourceHint.scheduleId
    && String(candidate.schedule.revision) === sourceHint.revision && candidate.schedule.assignments?.some(assignment => assignment.assignment_id === sourceHint.assignmentId));
  return <OperationsShell title="Published case schedule" description="Immutable approved plan recovered from this case, not substituted with a later current factory head." factoryId={data?.caseMeta?.factory_id ?? factoryId} demo={mode === "mock"} dataSource={mode === "mock" ? "fixture" : "live"} dataSourceMessage={mode === "mock" ? "DEMO / PREVIEW · isolated mock publication, no backend writes." : "Live Operations API · exact immutable case publication; newer factory heads are not substituted."} actions={<button className="dss-secondary" disabled={state.kind === "loading" || refreshing} onClick={refresh}>Refresh publication</button>}>
    {state.kind === "loading" ? <AsyncState kind="loading" title="Loading published case" /> : null}
    {"message" in state ? <AsyncState kind="error" title="Published case could not be loaded" description={state.message} onRetry={refresh} /> : null}
    {data && !factoryMatches ? <AsyncState kind="error" title="Case factory mismatch" description="The URL factory does not match the authoritative case. No plan is displayed." /> : null}
    {data && factoryMatches && !sourceMatches ? <AsyncState kind="error" title="Historical source identity mismatch" description="This case artifact does not match the exact schedule revision and assignment in the link. No current-head or different assignment is substituted." /> : null}
    {data && factoryMatches && sourceMatches && data.artifactState === "ready" && data.caseStatus.status === "COMMITTED" ? <PublishedDecisionSchedule data={mode === "mock" ? { ...data, source: "mock-workflow" } : data} assignmentId={sourceHint?.assignmentId} /> : null}
    {data && factoryMatches && (data.artifactState !== "ready" || data.caseStatus.status !== "COMMITTED") ? <AsyncState kind="empty" title="Published artifact unavailable" description="This case does not provide a verified committed recommendation artifact. No current-head or fixture plan is substituted." onRetry={refresh} /> : null}
  </OperationsShell>;
}

export function IntegratedSchedulePage({ api, factoryId, apiMode, caseId, sourceHint }: {
  api?: OperationsApiClient;
  factoryId?: string;
  apiMode?: OperationsApiMode;
  caseId?: string;
  sourceHint?: PublishedSourceHint;
} = {}) {
  const client = useMemo(() => api ?? (apiMode ? operationsUiClient(apiMode) : getOperationsApiClient()), [api, apiMode]);
  const selectedFactoryId = factoryId ?? getOperationsFactoryId();
  const selectedMode = apiMode ?? (api ? "mock" : getOperationsApiMode());
  if (caseId) return <CasePublishedSchedule api={client} caseId={caseId} factoryId={factoryId} mode={selectedMode} sourceHint={sourceHint} />;
  if (sourceHint) return <OperationsShell title="Published source required" factoryId={factoryId} dataSource="live" description="This historical source link requires its decision case identity."><AsyncState kind="error" title="Historical source identity incomplete" description="A case ID is required to recover the exact publication; the latest head will not be used instead." /></OperationsShell>;
  return <CurrentSchedulePage api={client} factoryId={selectedFactoryId} mode={selectedMode} />;
}

function CurrentSchedulePage({ api: client, factoryId: selectedFactoryId, mode: selectedMode }: { api: OperationsApiClient; factoryId: string; mode: OperationsApiMode }) {
  const { state, retry } = useOperationsContext({ api: client, factoryId: selectedFactoryId });

  return (
    <OperationsShell
      title="Integrated Schedule / Gantt"
      factoryId={selectedFactoryId}
      demo={selectedMode === "mock"}
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
