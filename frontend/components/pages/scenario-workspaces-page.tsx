"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TokenUser } from "@/lib/auth";
import type {
  CreateWorkspace,
  PlanningConfig,
  Workspace,
} from "@/types/generated/scenario-planning";
import {
  scenarioApi,
  scenarioError,
  matchesScenarioSchema,
  ScenarioError,
  type ScenarioClient,
} from "@/lib/scenario-planning/client";
import {
  useScenarioRead,
  useScenarioIntent,
  useUnsavedScenario,
} from "@/lib/scenario-planning/hooks";
import { scenarioHref } from "@/lib/scenario-planning/navigation";
import {
  defaultPlanningConfig,
  validateWeights,
} from "@/lib/scenario-planning/inputs";
import {
  Dependency,
  Field,
  IdentityDetails,
  ScenarioDialog,
  ScenarioFailure,
  ScenarioFrame,
  scenarioInput,
} from "@/components/scenario-planning/frame";
import { WeightFields } from "@/components/scenario-planning/editor";
import { AsyncState } from "@/components/research/async-state";

export function scenarioTime(value: string | null) {
  return value
    ? `${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))} UTC`
    : "Not provided";
}

function CreateWorkspacePanel({
  api,
  actor,
  factoryId,
  fresh,
  onCreated,
  onClose,
}: {
  api: ScenarioClient;
  actor: TokenUser;
  factoryId: string;
  fresh: boolean;
  onCreated: (workspace: Workspace) => void;
  onClose: () => void;
}) {
  const context = useScenarioRead({
    api,
    actor,
    scope: `create-context:${factoryId}`,
    read: (options) => api.currentContext(factoryId, options),
  });
  const [name, setName] = useState("");
  const [config, setConfig] = useState<PlanningConfig>(defaultPlanningConfig);
  const [review, setReview] = useState<CreateWorkspace>();
  const [error, setError] = useState<ScenarioError>();
  const [initialized, setInitialized] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  useEffect(() => {
    if (context.kind !== "ready" || !context.data || initialized) return;
    const window = context.data.snapshot.planning_window;
    setConfig((old) => ({
      ...old,
      horizon_minutes:
        (Date.parse(window.end_at) - Date.parse(window.start_at)) / 60000,
    }));
    setInitialized(true);
  }, [context.kind, context.data, initialized]);
  const intent = useScenarioIntent<CreateWorkspace, Workspace>({
    api,
    actor,
    scope: `create-workspace:${factoryId}`,
    send: async (body, options) => {
      const receipt = await api.createWorkspace(body, options);
      try {
        return await api.workspace(receipt.workspace_id, body.factory_id, {
          signal: options.signal,
        });
      } catch {
        throw new ScenarioError(503, "OUTCOME_UNVERIFIED");
      }
    },
    onAccepted: (workspace) => {
      setReview(undefined);
      setName("");
      setConfigDirty(false);
      onCreated(workspace);
    },
    onRejected: () => {
      setReview(undefined);
      context.refresh();
    },
  });
  useEffect(() => {
    if (intent.state.kind === "uncertain") setReview(undefined);
  }, [intent.state.kind]);
  useUnsavedScenario(Boolean(name.trim()) || configDirty || intent.unresolved);
  const current = context.kind === "ready" && context.data;
  const blocked = !fresh || !current || intent.unresolved || intent.busy;
  const headChanged =
    review &&
    current &&
    JSON.stringify(review.expected_head) !== JSON.stringify(current.head);
  return (
    <section
      className="space-y-5 rounded-lg border bg-white p-5"
      aria-label="Create scenario workspace"
    >
      <h2 className="text-lg font-semibold">
        Choose baseline and create workspace
      </h2>
      {context.kind === "loading" ? (
        <AsyncState
          compact
          kind="loading"
          title="Reading current snapshot and head"
        />
      ) : null}
      {context.error ? (
        <ScenarioFailure error={context.error} retry={context.refresh} />
      ) : null}
      {current ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (blocked) return;
            try {
              validateWeights(config.objective_weights);
              if (
                !name.trim() ||
                !matchesScenarioSchema(config, "PlanningConfig")
              )
                throw new ScenarioError(400, "INVALID_INPUT");
              const window = current.snapshot.planning_window;
              if (
                config.horizon_minutes !==
                (Date.parse(window.end_at) - Date.parse(window.start_at)) /
                  60000
              )
                throw new ScenarioError(400, "INVALID_WINDOW");
              setError(undefined);
              setReview({
                name: name.trim(),
                factory_id: factoryId,
                expected_head: { ...current.head },
                planning_config: structuredClone(config),
              });
            } catch (failure: unknown) {
              setError(scenarioError(failure));
            }
          }}
        >
          <fieldset disabled={blocked} className="grid gap-4 lg:grid-cols-2">
            <Field label="Workspace name">
              <input
                className={scenarioInput}
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Baseline snapshot">
              <select
                className={scenarioInput}
                aria-label="Baseline snapshot"
                value={current.snapshot.snapshot_id}
                onChange={() => {}}
              >
                <option value={current.snapshot.snapshot_id}>
                  {current.snapshot.snapshot_id} · plan{" "}
                  {current.head.plan_version}
                </option>
              </select>
            </Field>
          </fieldset>
          <p className="text-sm text-slate-600">
            {current.publication
              ? `Reference publication: ${current.publication.schedule_id}, revision ${current.publication.schedule_revision}.`
              : "No reference publication. A valid snapshot may still be used for simulation."}{" "}
            The reference is historical context, not proof of feasibility under
            new assumptions.
          </p>
          <fieldset disabled={blocked} className="grid gap-3 lg:grid-cols-5">
            {(
              [
                ["horizon_minutes", "Horizon (minutes)", 43200],
                ["candidate_limit", "Candidate limit", 3],
                ["solver_timeout_seconds", "Solver seconds / point", 30],
                ["simulation_runs", "MC draws / point", 1000],
                ["base_seed", "Base seed", 2147483647],
              ] as const
            ).map(([key, label, max]) => (
              <Field label={label} key={key}>
                <input
                  className={scenarioInput}
                  required
                  type="number"
                  readOnly={key === "horizon_minutes"}
                  step={1}
                  min={key === "base_seed" ? 0 : 1}
                  max={max}
                  value={Number.isFinite(config[key]) ? config[key] : ""}
                  onChange={(event) => {
                    setConfigDirty(true);
                    setConfig((old) => ({
                      ...old,
                      [key]: event.target.valueAsNumber,
                    }));
                  }}
                />
              </Field>
            ))}
          </fieldset>
          <WeightFields
            value={config.objective_weights}
            disabled={blocked}
            onChange={(value) => {
              setConfigDirty(true);
              setConfig((old) => ({ ...old, objective_weights: value }));
            }}
          />
          <p className="text-xs text-slate-500">
            Supported strategies: production priority, balanced and reliability
            priority. Baseline and scenario must share configuration, engine and
            sampling. No fourth strategy is invented.
          </p>
          {error ? <ScenarioFailure error={error} /> : null}
          <div className="flex gap-3">
            <button className="dss-primary" disabled={blocked} type="submit">
              Review workspace baseline
            </button>
            <button
              className="dss-secondary"
              type="button"
              disabled={intent.busy}
              onClick={() => {
                if (
                  (!name.trim() && !configDirty && !intent.unresolved) ||
                  window.confirm(
                    "Leave workspace creation? The unsaved input and any unconfirmed request are memory-only.",
                  )
                )
                  onClose();
              }}
            >
              Close creation
            </button>
          </div>
        </form>
      ) : null}
      {intent.state.error ? (
        <ScenarioFailure error={intent.state.error} />
      ) : null}
      {intent.state.kind === "uncertain" ? (
        <Dependency title="Workspace creation outcome unconfirmed">
          Retry the original head, key and body. No new intent can be created.
          <button
            className="dss-primary ml-3"
            disabled={!fresh || intent.busy}
            onClick={intent.retry}
          >
            Retry original create
          </button>
        </Dependency>
      ) : null}
      {intent.state.kind === "rejected" ? (
        <button
          className="dss-secondary"
          disabled={!fresh || context.kind !== "ready"}
          onClick={intent.reviewed}
        >
          I reviewed the refreshed context
        </button>
      ) : null}
      <ScenarioDialog
        title="Confirm workspace baseline"
        open={Boolean(review)}
        fresh={fresh && !headChanged && context.kind === "ready"}
        busy={intent.busy}
        onClose={() => setReview(undefined)}
        confirmLabel="Create reviewed workspace"
        onConfirm={() => {
          if (review && !blocked && !headChanged) intent.start(review);
        }}
      >
        {review ? (
          <>
            <p className="text-sm">
              Pin <strong>{review.name}</strong> to snapshot{" "}
              <strong className="break-all">
                {review.expected_head.snapshot_id}
              </strong>
              , plan {review.expected_head.plan_version}, head revision{" "}
              {review.expected_head.revision} in {factoryId}.
            </p>
            <p className="text-sm">
              Only creating a saved workspace. No planner run, approval,
              publication or physical operation is submitted.
            </p>
            <dl className="grid gap-3 text-sm lg:grid-cols-3">
              {Object.entries(review.planning_config)
                .filter(
                  ([key]) =>
                    !["objective_weights", "allowed_strategy_ids"].includes(
                      key,
                    ),
                )
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-slate-500">
                      {label.replaceAll("_", " ")}
                    </dt>
                    <dd className="mt-1 tabular-nums">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </>
        ) : null}
        {headChanged ? (
          <p role="alert">
            Context changed. Return to the editor and explicitly review a new
            baseline; this request is not rebased.
          </p>
        ) : null}
      </ScenarioDialog>
    </section>
  );
}

export function ScenarioWorkspacesPage({
  factoryId,
  cursor,
  api = scenarioApi,
}: {
  factoryId: string;
  cursor?: string;
  api?: ScenarioClient;
}) {
  return (
    <ScenarioFrame factoryId={factoryId} api={api}>
      {(actor, fresh) => (
        <Directory
          key={`${actor.id}:${actor.role}:${factoryId}:${cursor ?? ""}`}
          api={api}
          actor={actor}
          fresh={fresh}
          factoryId={factoryId}
          cursor={cursor}
        />
      )}
    </ScenarioFrame>
  );
}
function Directory({
  factoryId,
  cursor,
  api,
  actor,
  fresh,
}: {
  factoryId: string;
  cursor?: string;
  api: ScenarioClient;
  actor: TokenUser;
  fresh: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [factoryDraft, setFactoryDraft] = useState(factoryId);
  const read = useScenarioRead({
    api,
    actor,
    scope: `workspaces:${factoryId}:${cursor ?? ""}`,
    read: (options) =>
      factoryId.trim()
        ? api.listWorkspaces(factoryId, { cursor, limit: 20 }, options)
        : Promise.reject(new ScenarioError(400, "INVALID_INPUT")),
  });
  const management = ["ADMIN", "ENGINEER"].includes(actor.role);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-800">
            Operations / simulation
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Scenario Planning</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Save a factory baseline and explore hypothetical assumptions.
            Simulations do not update the live schedule.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="dss-secondary"
            disabled={!fresh || read.kind === "loading"}
            onClick={read.refresh}
          >
            Refresh workspaces
          </button>
          {management ? (
            <button
              className="dss-primary"
              disabled={!fresh || creating}
              onClick={() => setCreating(true)}
            >
              Create workspace
            </button>
          ) : null}
        </div>
      </header>
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            creating &&
            !window.confirm(
              "Switch factory? Unsaved workspace inputs are memory-only. Reconcile any unconfirmed create before a different intent.",
            )
          )
            return;
          router.push(scenarioHref(factoryDraft.trim()));
        }}
      >
        <Field label="Factory context">
          <input
            className={scenarioInput}
            required
            maxLength={128}
            value={factoryDraft}
            onChange={(event) => setFactoryDraft(event.target.value)}
          />
        </Field>
        <button className="dss-secondary">Open factory</button>
        <p className="text-xs text-slate-500">
          Saved analyses keep their original baseline when this factory
          advances.
        </p>
      </form>
      {creating && management ? (
        <CreateWorkspacePanel
          api={api}
          actor={actor}
          factoryId={factoryId}
          fresh={fresh}
          onClose={() => setCreating(false)}
          onCreated={(workspace) =>
            router.push(scenarioHref(factoryId, workspace.workspace_id))
          }
        />
      ) : null}
      {read.kind === "loading" ? (
        <AsyncState
          compact
          kind="loading"
          title={
            read.data
              ? "Refreshing — previous read shown, navigation disabled"
              : "Loading saved workspaces"
          }
        />
      ) : null}
      {read.error ? (
        <ScenarioFailure error={read.error} retry={read.refresh} />
      ) : null}
      {read.kind === "ready" && !read.data?.items.length ? (
        <AsyncState
          kind="empty"
          title="No saved workspaces"
          description="No workspace was returned in this factory scope. Create one from a verified current snapshot when the Scenario service is available."
        />
      ) : null}
      {read.data?.items.length ? (
        <section
          aria-label="Saved workspaces"
          className="overflow-auto rounded-lg border bg-white"
        >
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs text-slate-500">
              <tr>
                {[
                  "Workspace",
                  "Pinned baseline",
                  "Reference publication",
                  "Engine / contract",
                  "Context",
                  "Created (UTC)",
                ].map((label) => (
                  <th className="p-4" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {read.data.items.map((workspace) => (
                <tr key={workspace.workspace_id} className="align-top">
                  <td className="max-w-64 p-4">
                    <Link
                      aria-disabled={!fresh || read.kind !== "ready"}
                      className={`break-words font-semibold text-blue-800 underline ${!fresh || read.kind !== "ready" ? "pointer-events-none opacity-50" : ""}`}
                      href={scenarioHref(factoryId, workspace.workspace_id)}
                    >
                      {workspace.name}
                    </Link>
                    <p className="mt-2 font-mono text-xs text-slate-500">
                      {workspace.workspace_id.slice(0, 8)}
                    </p>
                  </td>
                  <td className="max-w-64 break-all p-4 text-xs">
                    {workspace.baseline.snapshot_id}
                    <p className="mt-2">
                      Plan {workspace.baseline.plan_version}
                    </p>
                  </td>
                  <td className="max-w-56 break-all p-4 text-xs">
                    {workspace.baseline.publication ? (
                      <>
                        {workspace.baseline.publication.schedule_id}
                        <p className="mt-2">
                          Revision{" "}
                          {workspace.baseline.publication.schedule_revision}
                        </p>
                      </>
                    ) : (
                      "No reference publication"
                    )}
                  </td>
                  <td className="max-w-48 break-all p-4 text-xs">
                    {workspace.engine_version}
                    <p className="mt-2 text-slate-500">
                      {workspace.contract_version}
                    </p>
                  </td>
                  <td className="p-4">
                    <span
                      className={
                        workspace.stale ? "text-amber-900" : "text-slate-600"
                      }
                    >
                      {workspace.stale
                        ? "Historical baseline"
                        : "Current baseline"}
                    </span>
                  </td>
                  <td className="p-4 text-xs tabular-nums">
                    {scenarioTime(workspace.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {read.data ? (
        <nav
          aria-label="Workspace pagination"
          className="flex items-center justify-between gap-3"
        >
          <span className="text-xs text-slate-500">
            {read.data.items.length} displayed on this page · no total supplied
          </span>
          <div className="flex gap-3">
            {cursor ? (
              <Link href={scenarioHref(factoryId)} className="dss-secondary">
                First page
              </Link>
            ) : null}
            {read.data.next_cursor ? (
              <Link
                href={scenarioHref(factoryId, undefined, {
                  cursor: read.data.next_cursor,
                })}
                className="dss-secondary"
              >
                Next page
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
      <IdentityDetails
        values={{
          "Consumer status": "Producer proposal — not a frozen engine contract",
          Factory: factoryId,
        }}
      />
    </div>
  );
}
