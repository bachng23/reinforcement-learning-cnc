"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TokenUser } from "@/lib/auth";
import type {
  BaselineEntities,
  Draft,
  EnqueueRun,
  EnqueueSensitivity,
  Job,
  Workspace,
  LiveEvaluation,
  LiveCreated,
  EvaluationResult,
} from "@/types/generated/scenario-planning";
import {
  assertScenarioContext,
  sameScenarioHead,
  scenarioError,
  type ScenarioClient,
  ScenarioError,
} from "@/lib/scenario-planning/client";
import {
  validateSweep,
  validateWeights,
  weightNames,
} from "@/lib/scenario-planning/inputs";
import {
  useScenarioRead,
  useScenarioIntent,
  useUnsavedScenario,
  verifyScenarioWriteRead,
} from "@/lib/scenario-planning/hooks";
import {
  Dependency,
  Field,
  IdentityDetails,
  ScenarioDialog,
  ScenarioFailure,
  scenarioInput,
} from "./frame";
import { DraftReview } from "./editor";
import {
  EngineResultView,
  type ResultSelection,
  type SelectResult,
} from "./engine-result";
import { scenarioTime } from "@/components/pages/scenario-workspaces-page";

export function RunInspector({
  job,
  source,
  selection,
  onSelection,
}: {
  job: Job;
  source?: EvaluationResult;
  selection?: ResultSelection;
  onSelection?: SelectResult;
}) {
  return (
    <section
      aria-label="Selected run"
      className="min-w-0 space-y-5 rounded-lg border bg-white p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {job.kind === "SENSITIVITY"
              ? "Sensitivity job"
              : job.source_scenario_id
                ? "Scenario run"
                : "No-overrides baseline run"}
          </h2>
          <p className="mt-2 text-sm">
            {job.status} · attempt {job.attempt}
            {job.source_revision
              ? ` · frozen draft revision ${job.source_revision}`
              : ""}
          </p>
        </div>
        <span className="rounded-full border bg-slate-50 px-3 py-1 text-xs font-semibold">
          SIMULATION ONLY
        </span>
      </header>
      {job.kind === "RUN" ? (
        <nav
          aria-label="Selected run sections"
          className="flex flex-wrap gap-4 text-sm text-blue-800 underline underline-offset-4"
        >
          <a href="#sensitivity-inputs">Prepare sensitivity</a>
          <a href="#live-handoff">LIVE handoff</a>
        </nav>
      ) : null}
      {job.status === "QUEUED" || job.status === "RUNNING" ? (
        <p role="status" className="text-sm text-blue-900">
          Waiting for authoritative worker progress. Polling uses backoff;
          reload only reads this saved job.
        </p>
      ) : job.status === "FAILED" ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm"
        >
          The job failed.{" "}
          {job.error_code === "PLANNING_TIMEOUT" ||
          job.error_code === "SCENARIO_JOB_TIMEOUT"
            ? "Its deadline was reached."
            : "No successful result is substituted."}{" "}
          The API does not expose attempt history or a public retry-attempt
          command; retrying a read does not restart this job.
        </div>
      ) : null}
      <dl className="grid gap-4 text-sm lg:grid-cols-5">
        {[
          ["Engine", job.engine_version],
          ["Contract", job.contract_version],
          ["Started", scenarioTime(job.started_at)],
          ["Completed", scenarioTime(job.completed_at)],
          ["Deadline", scenarioTime(job.deadline_at)],
        ].map(([label, value]) => (
          <div className="min-w-0" key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-2 break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {job.points.length ? (
        <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Persisted per-point progress
          </summary>
          <div className="mt-3 overflow-auto">
            <table
              className="w-full min-w-[600px] text-left"
              aria-label="Per-point progress"
            >
              <thead className="bg-slate-100">
                <tr>
                  {["Point", "Requested value", "Worker outcome", "Result"].map(
                    (item) => (
                      <th className="p-3" key={item}>
                        {item}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {job.points.map((point) => (
                  <tr key={point.point_index}>
                    <td className="p-3">{point.point_index}</td>
                    <td className="p-3">{point.value ?? "Not provided"}</td>
                    <td className="p-3">{point.status}</td>
                    <td className="p-3">
                      {point.result
                        ? "Persisted engine result"
                        : "No result supplied"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {job.result ? (
        <EngineResultView
          result={job.result}
          source={source}
          selection={selection}
          onSelection={onSelection}
        />
      ) : (
        <Dependency title="Evaluated result unavailable">
          No accepted result is available for this job. KPI, constraints,
          ranking, schedules and sensitivity points are not substituted.
        </Dependency>
      )}
      <IdentityDetails
        values={{
          "Job ID": job.job_id,
          "Workspace ID": job.workspace_id,
          "Input hash": job.input_hash,
          "Source scenario": job.source_scenario_id,
          "Frozen source revision": job.source_revision,
          "Source run": job.source_run_id,
        }}
      />
    </section>
  );
}

export function RunReview({
  draft,
  snapshot,
  workspace,
  management,
  api,
  actor,
  onAccepted,
  fresh = false,
  refresh,
}: {
  draft?: Draft;
  snapshot?: BaselineEntities;
  workspace: Workspace;
  management: boolean;
  api?: ScenarioClient;
  actor?: TokenUser;
  onAccepted?: (job: Job) => void;
  fresh?: boolean;
  refresh?: () => void;
}) {
  if (!api || !actor || !onAccepted)
    return (
      <Dependency title="Run execution unavailable">
        The authenticated run service is unavailable.
      </Dependency>
    );
  return (
    <RunActions
      draft={draft}
      snapshot={snapshot}
      workspace={workspace}
      management={management}
      api={api}
      actor={actor}
      onAccepted={onAccepted}
      fresh={fresh}
      refresh={refresh}
    />
  );
}
function RunActions({
  draft,
  snapshot,
  workspace,
  management,
  api,
  actor,
  onAccepted,
  fresh,
  refresh,
}: {
  draft?: Draft;
  snapshot?: BaselineEntities;
  workspace: Workspace;
  management: boolean;
  api: ScenarioClient;
  actor: TokenUser;
  onAccepted: (job: Job) => void;
  fresh: boolean;
  refresh?: () => void;
}) {
  const [review, setReview] = useState<{ body: EnqueueRun; draft?: Draft }>();
  const [showInput, setShowInput] = useState(false);
  const allowed = management && ["ADMIN", "ENGINEER"].includes(actor.role);
  const intent = useScenarioIntent<EnqueueRun, Job>({
    api,
    actor,
    scope: `enqueue:${workspace.workspace_id}`,
    send: async (body, options) => {
      const receipt = await api.enqueueRun(
        workspace.workspace_id,
        body,
        options,
      );
      return verifyScenarioWriteRead(async () => {
        const job = await api.run(
          workspace.workspace_id,
          receipt.job_id,
          options,
        );
        assertScenarioContext(job, workspace);
        return job;
      });
    },
    onAccepted: (job) => {
      setReview(undefined);
      onAccepted(job);
    },
    onRejected: () => {
      setReview(undefined);
      refresh?.();
    },
  });
  useEffect(() => {
    if (intent.state.kind === "uncertain") setReview(undefined);
  }, [intent.state.kind]);
  useUnsavedScenario(intent.unresolved);
  const changed =
    review?.body.kind === "SCENARIO" &&
    (draft?.scenario_id !== review.body.scenario_id ||
      draft?.revision !== review.body.expected_revision);
  return (
    <section className="space-y-4 rounded-lg border bg-white p-5">
      <h2 className="text-lg font-semibold">Run immutable inputs</h2>
      <p className="text-sm text-slate-600">
        Run a saved revision after reviewing its assumptions. Unsaved editor
        changes are excluded. A later edit cannot change an enqueued run.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="dss-secondary"
          disabled={!draft || !snapshot}
          aria-expanded={showInput}
          onClick={() => setShowInput((value) => !value)}
        >
          Review saved run input
        </button>
        <button
          className="dss-secondary"
          disabled={!allowed || !fresh || intent.unresolved}
          onClick={() => setReview({ body: { kind: "BASELINE" } })}
        >
          Run baseline
        </button>
        <button
          className="dss-primary"
          disabled={
            !allowed || !fresh || !draft || !snapshot || intent.unresolved
          }
          onClick={() =>
            draft &&
            setReview({
              body: {
                kind: "SCENARIO",
                scenario_id: draft.scenario_id,
                expected_revision: draft.revision,
              },
              draft: structuredClone(draft),
            })
          }
        >
          Run saved scenario
        </button>
      </div>
      {!allowed ? (
        <p className="text-sm">
          Read-only role. Running a scenario requires ADMIN or ENGINEER.
        </p>
      ) : null}
      {showInput && draft && snapshot ? (
        <DraftReview draft={draft} snapshot={snapshot} workspace={workspace} />
      ) : null}
      {intent.state.error ? (
        <ScenarioFailure error={intent.state.error} />
      ) : null}
      {intent.busy ? (
        <p role="status">Enqueuing the original run request…</p>
      ) : null}
      {intent.state.kind === "uncertain" ? (
        <button className="dss-secondary" onClick={intent.retry}>
          Retry same run request
        </button>
      ) : null}
      {intent.state.kind === "rejected" ? (
        <button
          className="dss-secondary"
          onClick={() => {
            intent.reviewed();
            refresh?.();
          }}
        >
          Review new run request
        </button>
      ) : null}
      <ScenarioDialog
        title="Confirm immutable run"
        open={Boolean(review)}
        fresh={fresh && allowed && !changed}
        busy={intent.busy}
        onClose={() => setReview(undefined)}
        confirmLabel="Enqueue reviewed run"
        onConfirm={() =>
          review && !changed && fresh && allowed && intent.start(review.body)
        }
      >
        <p className="text-sm">
          {review?.body.kind === "BASELINE"
            ? "No-overrides baseline with the workspace configuration, weights and sampling."
            : `Saved scenario revision ${review?.draft?.revision}. The engine also computes a no-overrides baseline with this scenario configuration and weights.`}
        </p>
        {review?.draft && snapshot ? (
          <DraftReview
            draft={review.draft}
            snapshot={snapshot}
            workspace={workspace}
          />
        ) : null}
        {changed ? (
          <p role="alert">
            The saved revision changed. Close and review it again before a new
            run.
          </p>
        ) : null}
        <p className="text-sm">
          Engine {workspace.engine_version};{" "}
          {workspace.planning_config.simulation_runs} draws; seed{" "}
          {workspace.planning_config.base_seed}. This action does not publish a
          schedule.
        </p>
      </ScenarioDialog>
    </section>
  );
}

export function SensitivityInputs({
  workspace,
  source,
  snapshot,
  api,
  actor,
  onAccepted,
  fresh = false,
}: {
  workspace: Workspace;
  source?: Job;
  snapshot?: BaselineEntities;
  api?: ScenarioClient;
  actor?: TokenUser;
  onAccepted?: (job: Job) => void;
  fresh?: boolean;
}) {
  if (!api || !actor || !onAccepted)
    return (
      <Dependency title="Sensitivity service unavailable">
        Open a completed saved run to prepare a sweep.
      </Dependency>
    );
  return (
    <SweepForm
      key={source?.job_id ?? "none"}
      workspace={workspace}
      source={source}
      snapshot={snapshot}
      api={api}
      actor={actor}
      onAccepted={onAccepted}
      fresh={fresh}
    />
  );
}
function SweepForm({
  workspace,
  source,
  snapshot,
  api,
  actor,
  onAccepted,
  fresh,
}: {
  workspace: Workspace;
  source?: Job;
  snapshot?: BaselineEntities;
  api: ScenarioClient;
  actor: TokenUser;
  onAccepted: (job: Job) => void;
  fresh: boolean;
}) {
  const [type, setType] = useState<EnqueueSensitivity["axis"]["type"]>(
    "MAINTENANCE_DURATION",
  );
  const [target, setTarget] = useState<string>();
  const [weight, setWeight] =
    useState<(typeof weightNames)[number]>("reliability");
  const [values, setValues] = useState([30, 60, 90, 120, 150]);
  const [review, setReview] = useState<EnqueueSensitivity>();
  const [error, setError] = useState<ScenarioError>();
  const result =
    source?.result && "scenario" in source.result ? source.result : undefined;
  // The immutable entities and saved result are independent reads. Derive an
  // untouched default when both arrive; never overwrite the user's choice.
  const eligibleRequests = snapshot?.maintenance_requests.filter(
    (item) => !["COMPLETED", "CANCELLED"].includes(item.status),
  );
  const frozenDuration = result?.effective.overrides.find(
    (item) => item.type === "MAINTENANCE_DURATION",
  );
  const defaultTarget = frozenDuration
    ? eligibleRequests?.find(
        (item) =>
          item.maintenance_request_id === frozenDuration.maintenance_request_id,
      )?.maintenance_request_id
    : eligibleRequests?.[0]?.maintenance_request_id;
  const selectedTarget = target ?? defaultTarget ?? "";
  const allowed = ["ADMIN", "ENGINEER"].includes(actor.role);
  const complete =
    source?.kind === "RUN" && source.status === "SUCCEEDED" && Boolean(result);
  const canRerank =
    result?.scenario.outcome === "FEASIBLE" &&
    Boolean(result.scenario.ranking) &&
    Boolean(result.scenario.candidates?.length);
  const intent = useScenarioIntent<EnqueueSensitivity, Job>({
    api,
    actor,
    scope: `sweep:${workspace.workspace_id}:${source?.job_id ?? "none"}`,
    send: async (body, options) => {
      const receipt = await api.enqueueSensitivity(
        workspace.workspace_id,
        body,
        options,
      );
      return verifyScenarioWriteRead(async () => {
        const job = await api.sensitivity(
          workspace.workspace_id,
          receipt.job_id,
          options,
        );
        assertScenarioContext(job, workspace, source);
        return job;
      });
    },
    onAccepted: (job) => {
      setReview(undefined);
      onAccepted(job);
    },
    onRejected: () => setReview(undefined),
  });
  useEffect(() => {
    if (intent.state.kind === "uncertain") setReview(undefined);
  }, [intent.state.kind]);
  useUnsavedScenario(intent.unresolved);
  return (
    <section
      id="sensitivity-inputs"
      aria-label="Sensitivity analysis"
      className="scroll-mt-32 space-y-5 rounded-lg border bg-white p-5"
    >
      <h2 className="text-lg font-semibold">Sensitivity analysis</h2>
      <p className="text-sm text-slate-600">
        One physical parameter or objective weight, at most seven unique values.
        Default: five samples. Source run, effective overrides, other weights
        and sampling remain fixed.
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!source || !result || !allowed || intent.unresolved) return;
          try {
            const axis: EnqueueSensitivity["axis"] =
              type === "MAINTENANCE_DURATION"
                ? {
                    type,
                    maintenance_request_id: selectedTarget,
                    values: values as [number, ...number[]],
                  }
                : { type, weight, values: values as [number, ...number[]] };
            validateSweep(axis, snapshot);
            if (
              axis.type === "MAINTENANCE_DURATION" &&
              result.effective.overrides.length >= 5 &&
              !result.effective.overrides.some(
                (item) =>
                  item.type === "MAINTENANCE_DURATION" &&
                  item.maintenance_request_id === selectedTarget,
              )
            )
              throw new ScenarioError(400, "INVALID_INPUT");
            if (axis.type === "OBJECTIVE_WEIGHT" && !canRerank)
              throw new ScenarioError(400, "INVALID_INPUT");
            if (axis.type === "OBJECTIVE_WEIGHT" && result.scenario.ranking)
              for (const value of values)
                validateWeights({
                  ...result.scenario.ranking.raw_weights,
                  [weight]: value,
                });
            setError(undefined);
            setReview(structuredClone({ source_run_id: source.job_id, axis }));
          } catch (failure: unknown) {
            setError(scenarioError(failure));
          }
        }}
      >
        <fieldset
          disabled={!allowed || intent.unresolved}
          className="space-y-4"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Sweep parameter">
              <select
                className={scenarioInput}
                value={type}
                onChange={(event) => {
                  const next = event.target.value as typeof type;
                  setType(next);
                  setValues(
                    next === "OBJECTIVE_WEIGHT"
                      ? [0, 0.5, 1, 2, 4]
                      : [30, 60, 90, 120, 150],
                  );
                  setReview(undefined);
                }}
              >
                <option value="MAINTENANCE_DURATION">
                  Maintenance duration (minutes)
                </option>
                <option value="OBJECTIVE_WEIGHT" disabled={!canRerank}>
                  One objective weight
                </option>
              </select>
            </Field>
            {type === "MAINTENANCE_DURATION" ? (
              <Field label="Baseline maintenance target">
                <select
                  className={scenarioInput}
                  required
                  value={selectedTarget}
                  disabled={!snapshot}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    setReview(undefined);
                  }}
                >
                  <option value="">Choose a pinned baseline request</option>
                  {snapshot?.maintenance_requests.map((item) => (
                    <option
                      key={item.maintenance_request_id}
                      value={item.maintenance_request_id}
                      disabled={
                        ["COMPLETED", "CANCELLED"].includes(item.status) ||
                        Boolean(
                          result &&
                          result.effective.overrides.length >= 5 &&
                          !result.effective.overrides.some(
                            (override) =>
                              override.type === "MAINTENANCE_DURATION" &&
                              override.maintenance_request_id ===
                                item.maintenance_request_id,
                          ),
                        )
                      }
                    >
                      {item.machine_id} · {item.maintenance_request_id}
                      {item.mandatory ? " · mandatory" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Objective weight">
                <select
                  className={scenarioInput}
                  value={weight}
                  onChange={(event) => {
                    setWeight(event.target.value as typeof weight);
                    setReview(undefined);
                  }}
                >
                  {weightNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <fieldset className="grid gap-3 lg:grid-cols-7">
            <legend className="mb-3 text-sm font-medium">
              Explicit sample values (
              {type === "MAINTENANCE_DURATION"
                ? "integer minutes, 1–43200"
                : "raw weight, 0–1000000"}
              )
            </legend>
            {values.map((value, index) => (
              <Field key={index} label={`Point ${index + 1}`}>
                <input
                  required
                  aria-label={`Sensitivity point ${index + 1}`}
                  className={scenarioInput}
                  type="number"
                  min={type === "MAINTENANCE_DURATION" ? 1 : 0}
                  max={type === "MAINTENANCE_DURATION" ? 43200 : 1e6}
                  step={type === "MAINTENANCE_DURATION" ? 1 : "any"}
                  value={Number.isFinite(value) ? value : ""}
                  onChange={(event) => {
                    setValues((old) =>
                      old.map((item, i) =>
                        i === index ? event.target.valueAsNumber : item,
                      ),
                    );
                    setReview(undefined);
                  }}
                />
              </Field>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button
              className="dss-secondary"
              type="button"
              disabled={values.length >= 7}
              onClick={() => {
                setValues((old) => [...old, NaN]);
                setReview(undefined);
              }}
            >
              Add sample
            </button>
            <button
              className="dss-secondary"
              type="button"
              disabled={values.length <= 1}
              onClick={() => {
                setValues((old) => old.slice(0, -1));
                setReview(undefined);
              }}
            >
              Remove last sample
            </button>
            <button
              className="dss-secondary"
              type="submit"
              disabled={
                !complete || (type === "MAINTENANCE_DURATION" && !snapshot)
              }
            >
              Review sweep inputs
            </button>
          </div>
        </fieldset>
      </form>
      {!complete ? (
        <p className="text-sm">
          Choose a completed saved run with an accepted engine result.
        </p>
      ) : null}
      {complete && !canRerank ? (
        <p className="text-sm">
          Weight reranking requires a feasible candidate set and ranking from
          the saved source. Physical replanning can still report its own
          feasibility.
        </p>
      ) : null}
      {review && !fresh ? (
        <p role="status">Refreshing source context before confirmation…</p>
      ) : null}
      {error ? <ScenarioFailure error={error} /> : null}
      {intent.busy ? (
        <p role="status">
          Submitting the frozen sensitivity request. Wait for its authoritative
          job receipt.
        </p>
      ) : null}
      {intent.state.error ? (
        <ScenarioFailure error={intent.state.error} />
      ) : null}
      {intent.state.kind === "uncertain" ? (
        <button className="dss-secondary" onClick={intent.retry}>
          Retry same sensitivity request
        </button>
      ) : null}
      {intent.state.kind === "rejected" ? (
        <button className="dss-secondary" onClick={intent.reviewed}>
          Review new sensitivity request
        </button>
      ) : null}
      <ScenarioDialog
        title="Confirm fixed-input sensitivity"
        open={Boolean(review)}
        fresh={fresh && allowed && Boolean(complete)}
        busy={intent.busy}
        onClose={() => setReview(undefined)}
        confirmLabel="Start sensitivity job"
        onConfirm={() => review && fresh && allowed && intent.start(review)}
      >
        <p className="text-sm">
          Source saved run {source?.job_id} · frozen revision{" "}
          {source?.source_revision ?? "baseline"}. Axis{" "}
          {review?.axis.type === "OBJECTIVE_WEIGHT"
            ? review.axis.weight
            : review?.axis.maintenance_request_id}
          ; values {review?.axis.values.join(", ")}.
        </p>
        <p className="text-sm">
          Fixed engine {source?.engine_version}; {result?.sampling.sample_count}{" "}
          draws; seed {result?.sampling.base_seed}; {result?.sampling.coupling}.
          Source input hash remains {source?.input_hash}.
        </p>
        <ul className="list-disc space-y-1 break-words pl-5 text-sm">
          {result?.effective.overrides.map((item, i) => (
            <li key={i}>
              {item.type} ·{" "}
              {item.type === "TECHNICIAN_UNAVAILABLE"
                ? `${item.technician_id}: ${item.start_at} → ${item.end_at}`
                : item.type === "MAINTENANCE_DURATION"
                  ? `${item.maintenance_request_id}: ${item.expected_duration_minutes} minutes`
                  : `${item.maintenance_request_id}: ${item.earliest_start_at}`}
            </li>
          ))}
        </ul>
        <dl className="grid gap-3 text-xs lg:grid-cols-5">
          {result?.scenario.ranking
            ? Object.entries(result.scenario.ranking.raw_weights).map(
                ([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      {value}
                      {review?.axis.type === "OBJECTIVE_WEIGHT" &&
                      review.axis.weight === name
                        ? " — swept; other weights retained"
                        : " — fixed"}
                    </dd>
                  </div>
                ),
              )
            : null}
        </dl>
        <p className="text-sm">
          {review?.axis.type === "OBJECTIVE_WEIGHT"
            ? "Rerank the same candidate set, KPI and normalization reference. Only the selected raw weight varies."
            : "Replan and validate every physical sample. Infeasible and failed points keep their own outcome."}
        </p>
      </ScenarioDialog>
    </section>
  );
}

export function LiveHandoffReview({
  workspace,
  source,
  api,
  actor,
  fresh = false,
}: {
  workspace: Workspace;
  source?: Job;
  api: ScenarioClient;
  actor: TokenUser;
  fresh?: boolean;
}) {
  const [reviewing, setReviewing] = useState(false);
  const result =
    source?.result && "scenario" in source.result ? source.result : undefined;
  const allowed = ["ADMIN", "ENGINEER"].includes(actor.role);
  const eligible =
    source?.kind === "RUN" &&
    source.status === "SUCCEEDED" &&
    source.source_scenario_id !== null &&
    result?.scenario.outcome === "FEASIBLE";
  return (
    <section
      id="live-handoff"
      className="scroll-mt-32 space-y-4 rounded-lg border bg-white p-5"
    >
      <h2 className="text-lg font-semibold">Evaluate LIVE separately</h2>
      <p className="text-sm text-slate-600">
        A completed saved scenario creates a new LIVE case for fresh planning
        and human approval. A simulation schedule cannot be committed.
      </p>
      <button
        className="dss-secondary"
        // Opening the review is read-only. Gate confirmation on fresh context.
        disabled={!allowed || !eligible}
        aria-expanded={reviewing}
        onClick={() => setReviewing((value) => !value)}
      >
        Review LIVE handoff
      </button>
      {!allowed ? (
        <p className="text-sm">
          Your role can read analysis but cannot create a LIVE evaluation.
        </p>
      ) : null}
      {result ? (
        <div className="space-y-2 text-sm">
          <p>
            Mapping:{" "}
            {result.live_mapping.supported
              ? "Supported by backend"
              : "Unsupported assumptions"}
          </p>
          <ul className="list-disc break-words pl-5">
            {result.live_mapping.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {reviewing && eligible && source && result ? (
        <LiveContext
          workspace={workspace}
          source={source}
          result={result}
          api={api}
          actor={actor}
          fresh={fresh}
        />
      ) : null}
    </section>
  );
}
function LiveContext({
  workspace,
  source,
  result,
  api,
  actor,
  fresh,
}: {
  workspace: Workspace;
  source: Job;
  result: EvaluationResult;
  api: ScenarioClient;
  actor: TokenUser;
  fresh: boolean;
}) {
  const router = useRouter();
  const [review, setReview] = useState<LiveEvaluation>();
  const [created, setCreated] = useState<LiveCreated>();
  const current = useScenarioRead({
    api,
    actor,
    scope: `live-context:${workspace.baseline.factory_id}:${source.job_id}`,
    read: (options) =>
      api.currentContext(workspace.baseline.factory_id, options),
  });
  const intent = useScenarioIntent<LiveEvaluation, LiveCreated>({
    api,
    actor,
    scope: `live:${workspace.workspace_id}:${source.job_id}`,
    send: async (body, options) => {
      const receipt = await api.evaluateLive(
        workspace.workspace_id,
        body,
        options,
      );
      return verifyScenarioWriteRead(() =>
        api.verifyLiveCase(receipt, workspace.baseline.factory_id, options),
      );
    },
    onAccepted: (receipt) => {
      setReview(undefined);
      setCreated(receipt);
      router.push(
        `/operations/recommendations?factory_id=${encodeURIComponent(workspace.baseline.factory_id)}&caseId=${encodeURIComponent(receipt.decision_case_id)}`,
      );
    },
    onRejected: () => {
      setReview(undefined);
      current.refresh();
    },
  });
  useEffect(() => {
    if (intent.state.kind === "uncertain") setReview(undefined);
  }, [intent.state.kind]);
  useUnsavedScenario(intent.unresolved);
  const matches = Boolean(
    current.data &&
    current.data.head.snapshot_id === workspace.baseline.snapshot_id &&
    current.data.head.plan_version === workspace.baseline.plan_version &&
    !workspace.stale,
  );
  const available =
    fresh &&
    current.kind === "ready" &&
    matches &&
    result.live_mapping.supported;
  const changed = Boolean(
    review &&
    current.data &&
    !sameScenarioHead(review.expected_head, current.data.head),
  );
  return (
    <div className="space-y-4 rounded border p-4">
      <h3 className="font-semibold">Current context and supported mapping</h3>
      {current.kind === "loading" ? (
        <p role="status">Reading current LIVE context…</p>
      ) : null}
      {current.error ? (
        <ScenarioFailure error={current.error} retry={current.refresh} />
      ) : null}
      {current.data ? (
        <>
          <dl className="grid gap-3 text-sm lg:grid-cols-2">
            <div>
              <dt className="text-slate-500">Scenario basis</dt>
              <dd className="break-all">
                {workspace.baseline.snapshot_id} · plan{" "}
                {workspace.baseline.plan_version}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Current LIVE context</dt>
              <dd className="break-all">
                {current.data.head.snapshot_id} · plan{" "}
                {current.data.head.plan_version} · head revision{" "}
                {current.data.head.revision}
              </dd>
            </div>
          </dl>
          {!matches ? (
            <p
              role="alert"
              className="rounded border border-amber-200 bg-amber-50 p-4 text-sm"
            >
              The baseline is stale. Create a new workspace/case from current
              context and review again; this scenario will not be silently
              rebased.
            </p>
          ) : null}
          <div className="grid gap-3 text-sm lg:grid-cols-2">
            <div>
              <h4 className="font-medium">Mapped objective weights</h4>
              {result.live_mapping.mapped_weights ? (
                Object.entries(result.live_mapping.mapped_weights).map(
                  ([name, value]) => (
                    <p key={name}>
                      {name}: {value}
                    </p>
                  ),
                )
              ) : (
                <p>Not supported</p>
              )}
            </div>
            <div>
              <h4 className="font-medium">Mapped maintenance lower bounds</h4>
              {result.live_mapping.mapped_defer_bounds.length ? (
                result.live_mapping.mapped_defer_bounds.map((item) => (
                  <p className="break-all" key={item.maintenance_request_id}>
                    {item.maintenance_request_id}: {item.earliest_start_at}
                  </p>
                ))
              ) : (
                <p>No defer bounds supplied</p>
              )}
            </div>
          </div>
        </>
      ) : null}
      <button
        className="dss-primary"
        disabled={!available || intent.unresolved}
        onClick={() =>
          current.data &&
          setReview({
            source_run_id: source.job_id,
            confirmation: true,
            expected_head: structuredClone(current.data.head),
          })
        }
      >
        Evaluate LIVE
      </button>
      {intent.state.error ? (
        <ScenarioFailure error={intent.state.error} />
      ) : null}
      {intent.state.kind === "uncertain" ? (
        <button className="dss-secondary" onClick={intent.retry}>
          Retry same LIVE request
        </button>
      ) : null}
      {intent.busy ? (
        <p role="status">
          Creating and verifying the new LIVE case. The simulation publication
          remains unchanged.
        </p>
      ) : null}
      {intent.state.kind === "rejected" ? (
        <button
          className="dss-secondary"
          onClick={() => {
            intent.reviewed();
            current.refresh();
          }}
        >
          Review current LIVE context
        </button>
      ) : null}
      {created ? (
        <a
          className="text-blue-800 underline"
          href={`/operations/recommendations?factory_id=${encodeURIComponent(workspace.baseline.factory_id)}&caseId=${encodeURIComponent(created.decision_case_id)}`}
        >
          Open new LIVE case {created.decision_case_id}
        </a>
      ) : null}
      <ScenarioDialog
        title="Confirm new LIVE evaluation"
        open={Boolean(review)}
        fresh={available && !changed}
        busy={intent.busy}
        onClose={() => setReview(undefined)}
        confirmLabel="Create LIVE case"
        onConfirm={() =>
          review && available && !changed && intent.start(review)
        }
      >
        <p className="text-sm">
          Create a new LIVE case from saved run {source.job_id}, using only the
          backend-supported mapping shown above and the reviewed current head.
          It will run a new planner and require approval. No simulation
          candidate or publication is copied.
        </p>
        {changed ? (
          <p role="alert">
            The current head changed. Close and review current context again.
          </p>
        ) : null}
      </ScenarioDialog>
    </div>
  );
}
