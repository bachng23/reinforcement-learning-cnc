"use client";
import { useEffect, useRef, useState } from "react";
import { MetricTable } from "@/components/scenario-planning/engine-result";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TokenUser } from "@/lib/auth";
import { AsyncState } from "@/components/research/async-state";
import { ScenarioEditor } from "@/components/scenario-planning/editor";
import {
  Dependency,
  IdentityDetails,
  ScenarioFailure,
  ScenarioFrame,
} from "@/components/scenario-planning/frame";
import {
  LiveHandoffReview,
  RunInspector,
  RunReview,
  SensitivityInputs,
} from "@/components/scenario-planning/run-panels";
import {
  scenarioApi,
  assertScenarioContext,
  ScenarioError,
  type ScenarioClient,
} from "@/lib/scenario-planning/client";
import { useScenarioRead } from "@/lib/scenario-planning/hooks";
import { weightNames } from "@/lib/scenario-planning/inputs";
import {
  scenarioHref,
  type ScenarioSelection,
} from "@/lib/scenario-planning/navigation";
import type {
  Draft,
  Job,
  Workspace,
} from "@/types/generated/scenario-planning";
import { scenarioTime } from "./scenario-workspaces-page";

export function ScenarioWorkspacePage({
  workspaceId,
  selection,
  api = scenarioApi,
}: {
  workspaceId: string;
  selection: ScenarioSelection;
  api?: ScenarioClient;
}) {
  return (
    <ScenarioFrame factoryId={selection.factory_id} api={api}>
      {(actor, fresh) => (
        <WorkspaceContent
          key={`${actor.id}:${actor.role}:${selection.factory_id}:${workspaceId}`}
          api={api}
          actor={actor}
          sessionFresh={fresh}
          workspaceId={workspaceId}
          selection={selection}
        />
      )}
    </ScenarioFrame>
  );
}
function BaselineEditor({
  workspace,
  api,
  actor,
  fresh,
  children,
  fallback,
}: {
  workspace: Workspace;
  api: ScenarioClient;
  actor: TokenUser;
  fresh: boolean;
  fallback?: React.ReactNode;
  children: (
    snapshot: Awaited<ReturnType<ScenarioClient["baselineEntities"]>>,
    fresh: boolean,
  ) => React.ReactNode;
}) {
  const baseline = useScenarioRead({
    api,
    actor,
    scope: `baseline:${workspace.baseline.factory_id}:${workspace.workspace_id}:${workspace.baseline.snapshot_id}:${workspace.current_head?.snapshot_id ?? "none"}`,
    read: (options) => api.baselineEntities(workspace, options),
  });
  return (
    <>
      {baseline.kind === "loading" ? (
        <AsyncState
          compact
          kind="loading"
          title="Verifying pinned baseline entities"
        />
      ) : null}
      {baseline.error ? (
        <ScenarioFailure error={baseline.error} retry={baseline.refresh} />
      ) : null}
      {baseline.data
        ? children(baseline.data, fresh && baseline.kind === "ready")
        : fallback}
    </>
  );
}
function SavedDraftReadOnly({
  draft,
  historical,
}: {
  draft: Draft;
  historical: boolean;
}) {
  return (
    <section className="space-y-3 rounded-lg border bg-white p-5">
      <h2 className="font-semibold">
        {historical ? "Saved historical draft" : "Saved draft"}
      </h2>
      <p className="break-words text-sm">
        {draft.name} · revision {draft.revision}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm">
        {draft.note || "No note supplied"}
      </p>
      <ul className="space-y-2 text-sm">
        {draft.overrides.map((override, index) => (
          <li key={index} className="break-words">
            {override.type} ·{" "}
            {override.type === "TECHNICIAN_UNAVAILABLE"
              ? `${override.technician_id} · ${override.start_at} → ${override.end_at}`
              : override.type === "MAINTENANCE_DURATION"
                ? `${override.maintenance_request_id} · ${override.expected_duration_minutes} minutes`
                : `${override.maintenance_request_id} · earliest start ${override.earliest_start_at}`}
          </li>
        ))}
      </ul>
      <dl className="grid gap-3 text-xs lg:grid-cols-3">
        {weightNames.map((name) => (
          <div key={name}>
            <dt>{name.replaceAll("_", " ")}</dt>
            <dd>{draft.objective_weights[name]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">
        Saved values remain readable. Target editing and new runs require the
        immutable baseline entities; the current snapshot is never substituted.
      </p>
    </section>
  );
}
function SelectedRun({
  api,
  actor,
  workspace,
  runId,
  sensitivity = false,
  fresh = false,
  selection,
  onSelection,
  onAcceptedSensitivity,
  onSettled,
}: {
  api: ScenarioClient;
  actor: TokenUser;
  workspace: Workspace;
  runId: string;
  sensitivity?: boolean;
  fresh?: boolean;
  selection: ScenarioSelection;
  onSelection: (patch: Partial<ScenarioSelection>) => void;
  onAcceptedSensitivity?: (job: Job) => void;
  onSettled?: (job: Job) => void;
}) {
  const run = useScenarioRead({
    api,
    actor,
    scope: `run:${workspace.baseline.factory_id}:${workspace.workspace_id}:${runId}`,
    read: async (options) => {
      const result = await (sensitivity
        ? api.sensitivity(workspace.workspace_id, runId, options)
        : api.run(workspace.workspace_id, runId, options));
      const source =
        sensitivity && result.source_run_id
          ? await api.run(workspace.workspace_id, result.source_run_id, options)
          : undefined;
      if (source) assertScenarioContext(source, workspace);
      assertScenarioContext(result, workspace, source);
      return { job: result, source };
    },
    polling: (data) =>
      data.job.status === "QUEUED" || data.job.status === "RUNNING",
  });
  const entities = useScenarioRead({
    api,
    actor,
    scope: `sweep-entities:${workspace.workspace_id}`,
    enabled: !sensitivity,
    read: (options) => api.baselineEntities(workspace, options),
  });
  const settled = useRef(onSettled);
  settled.current = onSettled;
  useEffect(() => {
    if (run.data && ["SUCCEEDED", "FAILED"].includes(run.data.job.status))
      settled.current?.(run.data.job);
  }, [run.data]);
  return (
    <div
      id={sensitivity ? "saved-sensitivity" : "selected-run"}
      className="scroll-mt-32 space-y-5"
    >
      {run.kind === "loading" ? (
        <p role="status" className="text-sm text-slate-500">
          {run.data
            ? "Refreshing job — previous read shown"
            : "Loading saved job"}
        </p>
      ) : null}
      {run.error ? (
        <ScenarioFailure error={run.error} retry={run.refresh} />
      ) : null}
      {run.data ? (
        <>
          <RunInspector
            job={run.data.job}
            source={
              run.data.source?.result && "scenario" in run.data.source.result
                ? run.data.source.result
                : undefined
            }
            selection={{
              ...selection,
              candidate_id:
                !sensitivity && selection.sensitivity_id
                  ? undefined
                  : selection.candidate_id,
            }}
            onSelection={(patch) =>
              onSelection(
                sensitivity
                  ? patch
                  : { sensitivity_id: undefined, point: undefined, ...patch },
              )
            }
          />
          {!sensitivity && onAcceptedSensitivity ? (
            <>
              {entities.error ? (
                <ScenarioFailure
                  error={entities.error}
                  retry={entities.refresh}
                />
              ) : null}
              <SensitivityInputs
                workspace={workspace}
                source={run.data.job}
                snapshot={entities.data}
                api={api}
                actor={actor}
                onAccepted={onAcceptedSensitivity}
                fresh={
                  fresh && run.kind === "ready" && entities.kind === "ready"
                }
              />
            </>
          ) : null}
          {!sensitivity && (
            <LiveHandoffReview
              source={run.data.job}
              workspace={workspace}
              api={api}
              actor={actor}
              fresh={fresh && run.kind === "ready"}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
export function validateCompareSelection(ids: string[], jobs: Job[]) {
  if (new Set(ids).size !== ids.length || ids.length > 4)
    return "Choose at most four unique completed runs.";
  const selected = ids.map((id) => jobs.find((job) => job.job_id === id));
  if (
    selected.some(
      (job) => !job || job.status !== "SUCCEEDED" || job.kind !== "RUN",
    )
  )
    return "Every selection must be a completed run from this workspace. Load its saved row before selecting.";
  if (
    selected.filter((job) => job?.source_scenario_id === null).length > 1 ||
    selected.filter((job) => job?.source_scenario_id !== null).length > 3
  )
    return "Compare one baseline and at most three scenarios.";
  if (
    ids.length >= 2 &&
    selected.filter((job) => job?.source_scenario_id === null).length !== 1
  )
    return "Select one completed no-overrides baseline for direct comparison.";
  if (ids.length >= 2 && selected[0]?.source_scenario_id !== null)
    return "The no-overrides baseline must be the comparison reference. Select the baseline first.";
  return undefined;
}
function WorkspaceContent({
  api,
  actor,
  sessionFresh,
  workspaceId,
  selection,
}: {
  api: ScenarioClient;
  actor: TokenUser;
  sessionFresh: boolean;
  workspaceId: string;
  selection: ScenarioSelection;
}) {
  const router = useRouter();
  const [selectionError, setSelectionError] = useState("");
  const selectedIds = selection.compare ?? [];
  const comparisonReads = useScenarioRead({
    api,
    actor,
    scope: `compare-identities:${selection.factory_id}:${workspaceId}:${selectedIds.join(",")}`,
    read: async (options) => {
      if (
        selectedIds.length > 4 ||
        new Set(selectedIds).size !== selectedIds.length
      )
        throw new ScenarioError(400, "INVALID_INPUT");
      const jobs = await Promise.all(
        selectedIds.map((id) => api.run(workspaceId, id, options)),
      );
      return jobs;
    },
  });
  const read = useScenarioRead({
    api,
    actor,
    scope: `workspace:${selection.factory_id}:${workspaceId}:${selection.scenario_id ?? "new"}:${selection.draft_cursor ?? ""}:${selection.run_cursor ?? ""}`,
    read: async (options) => {
      const workspace = await api.workspace(
        workspaceId,
        selection.factory_id,
        options,
      );
      const [drafts, runs, draft] = await Promise.all([
        api.listDrafts(
          workspaceId,
          { cursor: selection.draft_cursor, limit: 20 },
          options,
        ),
        api.listRuns(
          workspaceId,
          { cursor: selection.run_cursor, limit: 20 },
          options,
        ),
        selection.scenario_id
          ? api.draft(workspaceId, selection.scenario_id, options)
          : Promise.resolve(undefined),
      ]);
      return { workspace, drafts, runs, draft };
    },
  });
  const data = read.data;
  const fresh = sessionFresh && read.kind === "ready";
  const syncRunList = (job: Job) => {
    const row = data?.runs.items.find((item) => item.job_id === job.job_id);
    // New commands already refresh the list. Reopening an immutable terminal
    // result must not repeatedly disable unrelated draft/run controls.
    if (
      job.kind === "RUN" &&
      row &&
      (row.status !== job.status || row.attempt !== job.attempt)
    )
      read.refresh();
  };
  const navigate = (patch: Partial<ScenarioSelection>) =>
    router.push(
      scenarioHref(selection.factory_id, workspaceId, {
        ...selection,
        ...patch,
      }),
      { scroll: false },
    );
  const comparisonRows = [
    ...new Map(
      [...(data?.runs.items ?? []), ...(comparisonReads.data ?? [])].map(
        (row) => [row.job_id, row],
      ),
    ).values(),
  ];
  const compareError =
    data && comparisonReads.kind === "ready"
      ? validateCompareSelection(selectedIds, comparisonRows)
      : undefined;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-blue-800">
            Scenario Planning / workspace
          </p>
          <h1 className="mt-2 break-words text-2xl font-semibold">
            {data?.workspace.name ?? "Saved workspace"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            SIMULATION ONLY · production state remains unchanged
          </p>
        </div>
        <button
          className="dss-secondary"
          disabled={!sessionFresh || read.kind === "loading"}
          onClick={read.refresh}
        >
          Refresh workspace
        </button>
      </header>
      {read.kind === "loading" ? (
        <AsyncState
          compact
          kind="loading"
          title={
            data
              ? "Refreshing — previous read shown; editing disabled"
              : "Loading immutable workspace"
          }
        />
      ) : null}
      {read.error ? (
        <ScenarioFailure error={read.error} retry={read.refresh} />
      ) : null}
      {data ? (
        <>
          <nav
            aria-label="Scenario workspace sections"
            className="sticky top-16 z-10 flex flex-wrap gap-4 rounded-lg border bg-white p-3 text-sm text-blue-800 shadow-sm"
          >
            <a className="underline underline-offset-4" href="#scenario-editor">
              Draft editor
            </a>
            <a className="underline underline-offset-4" href="#scenario-runs">
              Saved runs / compare
            </a>
            {selection.run_id ? (
              <a className="underline underline-offset-4" href="#selected-run">
                Selected run
              </a>
            ) : null}
            {selection.sensitivity_id ? (
              <a
                className="underline underline-offset-4"
                href="#saved-sensitivity"
              >
                Sensitivity results
              </a>
            ) : null}
          </nav>
          <section
            className="space-y-4 rounded-lg border bg-white p-5"
            aria-label="Workspace baseline"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Pinned baseline</h2>
              <span className="text-sm text-amber-900">
                {data.workspace.stale
                  ? "Historical — viewing is allowed; no automatic rebase"
                  : "Matches current context"}
              </span>
            </div>
            <dl className="grid gap-4 text-sm lg:grid-cols-4">
              {[
                ["Snapshot", data.workspace.baseline.snapshot_id],
                ["Plan version", String(data.workspace.baseline.plan_version)],
                [
                  "Reference publication",
                  data.workspace.baseline.publication
                    ? `${data.workspace.baseline.publication.schedule_id} · revision ${data.workspace.baseline.publication.schedule_revision}`
                    : "No reference publication",
                ],
                [
                  "Engine / contract",
                  `${data.workspace.engine_version} / ${data.workspace.contract_version}`,
                ],
              ].map(([name, value]) => (
                <div className="min-w-0" key={name}>
                  <dt className="text-xs text-slate-500">{name}</dt>
                  <dd className="mt-2 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-5 text-slate-500">
              The reference publication is pinned to this workspace. The
              computed baseline for each evaluation must use the same
              config/objectives/engine/sampling as its scenario. A reference
              schedule is not automatically feasible under new assumptions.
            </p>
          </section>
          <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside
              className="space-y-4 rounded-lg border bg-white p-4"
              aria-label="Saved scenario drafts"
            >
              <h2 className="font-semibold">Scenario drafts</h2>
              <Link
                className="dss-secondary"
                href={scenarioHref(selection.factory_id, workspaceId, {
                  ...selection,
                  scenario_id: undefined,
                })}
              >
                New draft
              </Link>
              {!data.drafts.items.length ? (
                <p className="text-sm text-slate-500">
                  No saved drafts on this page.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.drafts.items.map((draft) => (
                    <li key={draft.scenario_id}>
                      <Link
                        aria-current={
                          selection.scenario_id === draft.scenario_id
                            ? "page"
                            : undefined
                        }
                        className={`block rounded border p-3 text-sm ${selection.scenario_id === draft.scenario_id ? "border-blue-400 bg-blue-50" : ""}`}
                        href={scenarioHref(selection.factory_id, workspaceId, {
                          ...selection,
                          scenario_id: draft.scenario_id,
                        })}
                      >
                        <strong className="break-words">{draft.name}</strong>
                        <span className="mt-1 block text-xs text-slate-500">
                          Revision {draft.revision} · {draft.overrides.length}{" "}
                          assumptions
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {selection.draft_cursor ? (
                <Link
                  className="block text-sm text-blue-800 underline"
                  href={scenarioHref(selection.factory_id, workspaceId, {
                    ...selection,
                    draft_cursor: undefined,
                  })}
                >
                  First draft page
                </Link>
              ) : null}
              {data.drafts.next_cursor ? (
                <Link
                  className="block text-sm text-blue-800 underline"
                  href={scenarioHref(selection.factory_id, workspaceId, {
                    ...selection,
                    draft_cursor: data.drafts.next_cursor,
                  })}
                >
                  Next draft page
                </Link>
              ) : null}
            </aside>
            <div
              id="scenario-editor"
              className="min-w-0 scroll-mt-32 space-y-5"
            >
              <BaselineEditor
                api={api}
                actor={actor}
                workspace={data.workspace}
                fresh={fresh}
                fallback={
                  data.draft ? (
                    <SavedDraftReadOnly
                      draft={data.draft}
                      historical={data.workspace.stale}
                    />
                  ) : null
                }
              >
                {(snapshot, baselineFresh) => (
                  <>
                    <ScenarioEditor
                      key={data.draft?.scenario_id ?? "new"}
                      workspace={data.workspace}
                      snapshot={snapshot}
                      draft={data.draft}
                      api={api}
                      actor={actor}
                      fresh={baselineFresh}
                      refresh={read.refresh}
                      onSaved={(saved) => {
                        if (selection.scenario_id !== saved.scenario_id)
                          navigate({ scenario_id: saved.scenario_id });
                        else read.refresh();
                      }}
                    />
                    <RunReview
                      api={api}
                      actor={actor}
                      onAccepted={(job) => {
                        navigate({
                          run_id: job.job_id,
                          sensitivity_id: undefined,
                          candidate_id: undefined,
                          point: undefined,
                        });
                        read.refresh();
                      }}
                      fresh={baselineFresh}
                      refresh={read.refresh}
                      draft={data.draft}
                      snapshot={snapshot}
                      workspace={data.workspace}
                      management={["ADMIN", "ENGINEER"].includes(actor.role)}
                    />
                  </>
                )}
              </BaselineEditor>
            </div>
          </div>
          <section
            id="scenario-runs"
            className="scroll-mt-32 space-y-4 rounded-lg border bg-white p-5"
            aria-label="Saved runs"
          >
            <h2 className="text-lg font-semibold">Saved runs and comparison</h2>
            <p className="text-sm text-slate-500">
              Choose one completed baseline and at most three completed
              scenarios. List rows are summaries; selecting a run reads
              persisted detail.
            </p>
            {data.runs.items.length ? (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      {[
                        "Compare",
                        "Saved run",
                        "Status / attempt",
                        "Frozen source",
                        "Created (UTC)",
                      ].map((label) => (
                        <th key={label} className="p-3">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.runs.items.map((run) => (
                      <tr key={run.job_id}>
                        <td className="p-3">
                          <input
                            type="checkbox"
                            aria-label={`Compare run ${run.job_id}`}
                            // Selecting an immutable completed record is read-only.
                            // Background refresh must not interrupt a pointer click.
                            disabled={
                              run.status !== "SUCCEEDED" || run.kind !== "RUN"
                            }
                            checked={selectedIds.includes(run.job_id)}
                            onChange={(event) => {
                              const chosen = event.target.checked
                                ? [...selectedIds, run.job_id]
                                : selectedIds.filter((id) => id !== run.job_id);
                              const baselineId = chosen.find(
                                (id) =>
                                  comparisonRows.find(
                                    (job) => job.job_id === id,
                                  )?.source_scenario_id === null,
                              );
                              const next = baselineId
                                ? [
                                    baselineId,
                                    ...chosen.filter((id) => id !== baselineId),
                                  ]
                                : chosen;
                              const error = validateCompareSelection(
                                next,
                                comparisonRows,
                              );
                              if (error && event.target.checked) {
                                setSelectionError(error);
                                return;
                              }
                              setSelectionError("");
                              navigate({ compare: next });
                            }}
                          />
                        </td>
                        <td className="p-3">
                          <Link
                            className="font-mono text-xs text-blue-800 underline"
                            href={scenarioHref(
                              selection.factory_id,
                              workspaceId,
                              { ...selection, run_id: run.job_id },
                            )}
                          >
                            {run.source_scenario_id ? "Scenario" : "Baseline"}{" "}
                            {run.job_id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="p-3">
                          {run.status}
                          <span className="mt-1 block text-xs text-slate-500">
                            Attempt {run.attempt}
                          </span>
                        </td>
                        <td className="p-3 text-xs">
                          {run.source_scenario_id
                            ? `Draft ${run.source_scenario_id.slice(0, 8)} · revision ${run.source_revision}`
                            : "No overrides"}
                        </td>
                        <td className="p-3 text-xs tabular-nums">
                          {scenarioTime(run.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <AsyncState
                compact
                kind="empty"
                title="No saved runs"
                description="This workspace has no persisted run rows on this page. No baseline KPI or candidate schedule is fabricated."
              />
            )}
            <div className="flex flex-wrap justify-between gap-3">
              <p className="text-sm">{selectedIds.length}/4 selected</p>
              <div className="flex gap-3">
                {selection.run_cursor ? (
                  <Link
                    className="dss-secondary"
                    href={scenarioHref(selection.factory_id, workspaceId, {
                      ...selection,
                      run_cursor: undefined,
                    })}
                  >
                    First run page
                  </Link>
                ) : null}
                {data.runs.next_cursor ? (
                  <Link
                    className="dss-secondary"
                    href={scenarioHref(selection.factory_id, workspaceId, {
                      ...selection,
                      run_cursor: data.runs.next_cursor,
                    })}
                  >
                    Next run page
                  </Link>
                ) : null}
              </div>
            </div>
            {comparisonReads.error ? (
              <ScenarioFailure
                error={comparisonReads.error}
                retry={comparisonReads.refresh}
              />
            ) : null}
            {selectionError || compareError ? (
              <p role="alert" className="text-sm text-amber-900">
                {selectionError || compareError}
              </p>
            ) : null}
            {selectedIds.length >= 2 &&
            comparisonReads.kind === "ready" &&
            !compareError ? (
              <ComputedComparison
                api={api}
                actor={actor}
                workspace={data.workspace}
                ids={selectedIds}
                jobs={comparisonRows}
              />
            ) : (
              <Dependency title="Choose completed runs for comparison">
                {selectedIds.length < 2
                  ? "Select a baseline and a scenario to prepare comparison. "
                  : "The selected runs stay in the URL across pages. "}
                Comparison is read only after a completed baseline and scenario
                are selected and their saved metadata is verified.
              </Dependency>
            )}
          </section>
          {selection.run_id ? (
            <SelectedRun
              key={`${workspaceId}:${selection.run_id}`}
              api={api}
              actor={actor}
              workspace={data.workspace}
              runId={selection.run_id}
              fresh={fresh}
              selection={selection}
              onSelection={navigate}
              onSettled={syncRunList}
              onAcceptedSensitivity={(job) =>
                navigate({
                  sensitivity_id: job.job_id,
                  point: undefined,
                  candidate_id: undefined,
                })
              }
            />
          ) : (
            <Dependency title="Choose a saved run">
              Run progress, attempt, result availability and separate LIVE
              review appear after opening a saved run. Sensitivity requires a
              completed saved run.
            </Dependency>
          )}
          {selection.sensitivity_id ? (
            <SelectedRun
              key={`${workspaceId}:sensitivity:${selection.sensitivity_id}`}
              api={api}
              actor={actor}
              workspace={data.workspace}
              runId={selection.sensitivity_id}
              sensitivity
              fresh={fresh}
              selection={selection}
              onSelection={navigate}
            />
          ) : null}
          <IdentityDetails
            values={{
              "Workspace ID": workspaceId,
              Factory: data.workspace.baseline.factory_id,
              "Basis snapshot": data.workspace.baseline.snapshot_id,
              "Basis hash": data.workspace.baseline.snapshot_hash,
              "Publication hash":
                data.workspace.baseline.publication?.schedule_hash,
              Creator: data.workspace.created_by,
              Created: scenarioTime(data.workspace.created_at),
              "Current observation": data.workspace.current_head?.snapshot_id,
              "Current plan": data.workspace.current_head?.plan_version,
              "Current head revision": data.workspace.current_head?.revision,
              "Baseline horizon":
                data.workspace.planning_config.horizon_minutes,
              "Sampling specification":
                "Returned with each accepted saved result",
              "Model assumptions":
                "Displayed beside engine KPI and sensitivity results",
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function ComputedComparison({
  api,
  actor,
  workspace,
  ids,
  jobs,
}: {
  api: ScenarioClient;
  actor: TokenUser;
  workspace: Workspace;
  ids: string[];
  jobs: Job[];
}) {
  const read = useScenarioRead({
    api,
    actor,
    scope: `computed-comparison:${workspace.workspace_id}:${ids.join(",")}`,
    read: async (options) => {
      for (const id of ids) {
        const job = jobs.find((item) => item.job_id === id);
        if (!job) throw new ScenarioError(502, "CONTEXT_MISMATCH");
        assertScenarioContext(job, workspace);
      }
      const result = await api.compare(workspace.workspace_id, ids, options);
      const reference = jobs.find((job) => job.job_id === ids[0]);
      if (
        result.reference_identity.factory_id !==
          workspace.baseline.factory_id ||
        result.reference_identity.frozen_input_hash !== reference?.input_hash ||
        result.runs.some(
          (item) =>
            item.identity.frozen_input_hash !==
            jobs.find((job) => job.job_id === item.identity.run_id)?.input_hash,
        )
      )
        throw new ScenarioError(502, "CONTEXT_MISMATCH");
      return result;
    },
  });
  return (
    <section aria-label="Saved run comparison" className="space-y-5">
      {read.error ? (
        <ScenarioFailure error={read.error} retry={read.refresh} />
      ) : null}
      {read.kind === "loading" ? (
        <p role="status">Reading computed comparison…</p>
      ) : null}
      {read.data ? (
        <div className="rounded border bg-slate-50 p-4 text-sm">
          <h3 className="font-semibold">Saved no-overrides reference</h3>
          <p className="mt-2 break-all">
            {read.data.reference_identity.run_id}
          </p>
          <p className="mt-2">
            {read.data.reference_planning_config.simulation_runs} draws · seed{" "}
            {read.data.reference_sampling.base_seed} ·{" "}
            {read.data.reference_sampling.version}
          </p>
          <p>
            Weights:{" "}
            {Object.entries(
              read.data.reference_planning_config.objective_weights,
            )
              .map(([key, value]) => `${key} ${value}`)
              .join("; ")}
          </p>
          <p className="mt-2 text-xs">
            Each scenario below exposes its own configuration and overrides.
            Scores from different normalization references are not compared.
          </p>
        </div>
      ) : null}
      {read.data?.runs.map((run) => (
        <div
          className="min-w-0 space-y-4 rounded border p-4"
          key={run.identity.run_id}
        >
          <h3 className="break-all text-sm font-semibold">
            Run {run.identity.run_id} compared with{" "}
            {read.data!.reference_identity.run_id}
          </h3>
          <details className="text-sm">
            <summary className="cursor-pointer">
              Scenario configuration and frozen assumptions
            </summary>
            <p className="mt-2">
              {run.engine_version}; {run.planning_config.simulation_runs} draws;
              seed {run.sampling.base_seed}; {run.sampling.coupling}.
            </p>
            <p className="mt-2 break-words">
              Weights:{" "}
              {Object.entries(run.planning_config.objective_weights)
                .map(([key, value]) => `${key} ${value}`)
                .join("; ")}
            </p>
            <ul className="mt-2 list-disc space-y-1 break-words pl-5">
              {run.overrides.length ? (
                run.overrides.map((item, i) => (
                  <li key={i}>
                    {item.type} ·{" "}
                    {item.type === "TECHNICIAN_UNAVAILABLE"
                      ? `${item.technician_id}: ${item.start_at} → ${item.end_at}`
                      : item.type === "MAINTENANCE_DURATION"
                        ? `${item.maintenance_request_id}: ${item.expected_duration_minutes} minutes`
                        : `${item.maintenance_request_id}: ${item.earliest_start_at}`}
                  </li>
                ))
              ) : (
                <li>No overrides</li>
              )}
            </ul>
          </details>
          <MetricTable comparison={run.comparison} />
        </div>
      ))}
    </section>
  );
}
