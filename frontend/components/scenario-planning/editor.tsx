"use client";
import { useEffect, useState } from "react";
import type { TokenUser } from "@/lib/auth";
import type { BaselineEntities } from "@/types/generated/scenario-planning";
import type {
  CreateDraft,
  Draft,
  Workspace,
  UpdateDraft,
} from "@/types/generated/scenario-planning";
import {
  scenarioError,
  ScenarioError,
  type ScenarioClient,
} from "@/lib/scenario-planning/client";
import {
  requestedChanges,
  validateDraft,
  weightNames,
  type Override,
  type Weights,
} from "@/lib/scenario-planning/inputs";
import {
  useScenarioIntent,
  useUnsavedScenario,
} from "@/lib/scenario-planning/hooks";
import {
  Dependency,
  Field,
  ScenarioDialog,
  ScenarioFailure,
  scenarioInput,
} from "./frame";

export function WeightFields({
  value,
  onChange,
  disabled,
}: {
  value: Weights;
  onChange: (value: Weights) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="font-semibold">Objective weights</legend>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Five relative weights, each 0–1,000,000. At least one must be positive.
        Normalization and contributions are returned by the engine.
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        {weightNames.map((name) => (
          <Field key={name} label={name.replaceAll("_", " ")}>
            <input
              aria-label={`Weight ${name}`}
              type="number"
              min={0}
              max={1e6}
              step="any"
              required
              className={scenarioInput}
              value={Number.isFinite(value[name]) ? value[name] : ""}
              onChange={(event) =>
                onChange({ ...value, [name]: event.target.valueAsNumber })
              }
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}

function OverrideFields({
  value,
  snapshot,
  onChange,
  onRemove,
  index,
  disabled,
}: {
  value: Override;
  snapshot: BaselineEntities;
  onChange: (value: Override) => void;
  onRemove: () => void;
  index: number;
  disabled: boolean;
}) {
  const requests = snapshot.maintenance_requests ?? [];
  const technicians = snapshot.technicians ?? [];
  const target =
    value.type === "TECHNICIAN_UNAVAILABLE"
      ? value.technician_id
      : value.maintenance_request_id;
  const iso = (value: string) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString().slice(0, 19)
      : "";
  const utc = (value: string) =>
    value && Number.isFinite(Date.parse(`${value}Z`))
      ? new Date(`${value}Z`).toISOString()
      : "";
  return (
    <fieldset
      disabled={disabled}
      className="space-y-4 rounded-lg border border-slate-200 p-4"
    >
      <legend className="px-2 text-sm font-semibold">
        Assumption {index + 1}
      </legend>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">
            {value.type.replaceAll("_", " ")}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {value.type === "TECHNICIAN_UNAVAILABLE"
              ? "Technician resource availability only; user permissions are unchanged."
              : value.type === "DEFER_MAINTENANCE"
                ? "Earliest start is a lower bound. Mandatory, priority and hard constraints remain."
                : "Hypothetical expected duration; actual maintenance data remains unchanged."}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Remove assumption ${index + 1}`}
          className="dss-secondary shrink-0"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Field
          label={
            value.type === "TECHNICIAN_UNAVAILABLE"
              ? "Technician resource"
              : "Maintenance request"
          }
        >
          <select
            required
            aria-label={`Assumption ${index + 1} target`}
            className={scenarioInput}
            value={target}
            onChange={(event) =>
              onChange(
                value.type === "TECHNICIAN_UNAVAILABLE"
                  ? { ...value, technician_id: event.target.value }
                  : { ...value, maintenance_request_id: event.target.value },
              )
            }
          >
            <option value="">Choose a baseline target</option>
            {value.type === "TECHNICIAN_UNAVAILABLE"
              ? technicians.map((item) => (
                  <option key={item.technician_id} value={item.technician_id}>
                    {item.display_name} · {item.technician_id}
                  </option>
                ))
              : requests.map((item) => (
                  <option
                    key={item.maintenance_request_id}
                    value={item.maintenance_request_id}
                    disabled={["COMPLETED", "CANCELLED"].includes(item.status)}
                  >
                    {item.machine_id} · {item.maintenance_request_id} ·{" "}
                    {item.priority}
                    {item.mandatory ? " · mandatory" : ""}
                  </option>
                ))}
          </select>
        </Field>
        {value.type === "MAINTENANCE_DURATION" ? (
          <Field label="Expected duration (minutes)">
            <input
              required
              aria-label={`Assumption ${index + 1} duration`}
              className={scenarioInput}
              type="number"
              min={1}
              max={43200}
              step={1}
              value={
                Number.isFinite(value.expected_duration_minutes)
                  ? value.expected_duration_minutes
                  : ""
              }
              onChange={(event) =>
                onChange({
                  ...value,
                  expected_duration_minutes: event.target.valueAsNumber,
                })
              }
            />
          </Field>
        ) : value.type === "DEFER_MAINTENANCE" ? (
          <Field label="Earliest start (UTC)">
            <input
              required
              aria-label={`Assumption ${index + 1} earliest start`}
              className={scenarioInput}
              type="datetime-local"
              step={1}
              min={iso(snapshot.planning_window.start_at)}
              max={iso(snapshot.planning_window.end_at)}
              value={iso(value.earliest_start_at)}
              onChange={(event) =>
                onChange({
                  ...value,
                  earliest_start_at: utc(event.target.value),
                })
              }
            />
          </Field>
        ) : (
          <>
            <Field label="Unavailable from (UTC)">
              <input
                required
                aria-label={`Assumption ${index + 1} start`}
                type="datetime-local"
                step={1}
                className={scenarioInput}
                min={iso(snapshot.planning_window.start_at)}
                max={iso(snapshot.planning_window.end_at)}
                value={iso(value.start_at)}
                onChange={(event) =>
                  onChange({ ...value, start_at: utc(event.target.value) })
                }
              />
            </Field>
            <Field label="Unavailable until (UTC)">
              <input
                required
                aria-label={`Assumption ${index + 1} end`}
                type="datetime-local"
                step={1}
                className={scenarioInput}
                min={iso(snapshot.planning_window.start_at)}
                max={iso(snapshot.planning_window.end_at)}
                value={iso(value.end_at)}
                onChange={(event) =>
                  onChange({ ...value, end_at: utc(event.target.value) })
                }
              />
            </Field>
          </>
        )}
      </div>
    </fieldset>
  );
}

export function DraftReview({
  draft,
  snapshot,
  workspace,
}: {
  draft: CreateDraft;
  snapshot: BaselineEntities;
  workspace: Workspace;
}) {
  const changes = requestedChanges(draft, snapshot);
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Requested assumptions against{" "}
        <strong>{workspace.baseline.snapshot_id}</strong>, plan{" "}
        {workspace.baseline.plan_version}. This input preview is not an
        evaluated feasibility or effective-transform verdict.
      </p>
      {changes.length ? (
        <div className="overflow-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-100">
              <tr>
                {["Assumption / target", "Pinned baseline", "Requested"].map(
                  (name) => (
                    <th className="p-3" key={name}>
                      {name}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {changes.map((item, index) => (
                <tr key={index} className="align-top">
                  <th className="max-w-64 break-words p-3 font-medium">
                    {item.label}
                    <span className="mt-1 block text-xs text-slate-500">
                      {item.target}
                    </span>
                  </th>
                  <td className="max-w-64 break-words p-3 tabular-nums">
                    {item.before}
                  </td>
                  <td className="max-w-64 break-words p-3 tabular-nums">
                    {item.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm">
          No overrides requested. Only the listed objective weights may differ.
        </p>
      )}
      <dl className="grid gap-3 text-xs lg:grid-cols-5">
        {weightNames.map((name) => (
          <div key={name}>
            <dt className="text-slate-500">{name.replaceAll("_", " ")}</dt>
            <dd className="mt-1 font-mono">
              {workspace.planning_config.objective_weights[name]} →{" "}
              {draft.objective_weights[name]}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-5 text-slate-500">
        A future run freezes this revision, configuration and sampling. The
        computed no-overrides baseline must use the same
        objectives/config/engine/sampling. The reference publication is a
        separate historical source.
      </p>
    </div>
  );
}

export function ScenarioEditor({
  workspace,
  snapshot,
  draft,
  api,
  actor,
  fresh,
  onSaved,
  refresh,
}: {
  workspace: Workspace;
  snapshot: BaselineEntities;
  draft?: Draft;
  api: ScenarioClient;
  actor: TokenUser;
  fresh: boolean;
  onSaved: (draft: Draft) => void;
  refresh: () => void;
}) {
  const eligibleRequests = snapshot.maintenance_requests.filter(
    (item) => !["COMPLETED", "CANCELLED"].includes(item.status),
  );
  const [input, setInput] = useState<CreateDraft>(() =>
    draft
      ? {
          name: draft.name,
          note: draft.note,
          overrides: structuredClone(draft.overrides),
          objective_weights: { ...draft.objective_weights },
        }
      : {
          name: "",
          note: "",
          overrides: [],
          objective_weights: { ...workspace.planning_config.objective_weights },
        },
  );
  const [baseRevision, setBaseRevision] = useState(draft?.revision);
  const [savedInput, setSavedInput] = useState(JSON.stringify(input));
  const [template, setTemplate] = useState<Override["type"]>(
    "MAINTENANCE_DURATION",
  );
  const [review, setReview] = useState<CreateDraft>();
  const [error, setError] = useState<ScenarioError>();
  const management = ["ADMIN", "ENGINEER"].includes(actor.role);
  const changedRevision =
    draft !== undefined && draft.revision !== baseRevision;
  const intent = useScenarioIntent<CreateDraft | UpdateDraft, Draft>({
    api,
    actor,
    scope: `${workspace.baseline.factory_id}:${workspace.workspace_id}:save:${draft?.scenario_id ?? "new"}`,
    send: async (body, options) => {
      const receipt = await api.saveDraft(
        workspace.workspace_id,
        body,
        options,
        draft?.scenario_id,
      );
      try {
        return await api.draft(workspace.workspace_id, receipt.scenario_id, {
          signal: options.signal,
        });
      } catch {
        throw new ScenarioError(503, "OUTCOME_UNVERIFIED");
      }
    },
    onAccepted: (saved) => {
      const next = {
        name: saved.name,
        note: saved.note,
        overrides: saved.overrides,
        objective_weights: saved.objective_weights,
      };
      setInput(next);
      setSavedInput(JSON.stringify(next));
      setBaseRevision(saved.revision);
      setReview(undefined);
      onSaved(saved);
    },
    onRejected: () => {
      setReview(undefined);
      refresh();
    },
  });
  useEffect(() => {
    if (intent.state.kind === "uncertain") setReview(undefined);
  }, [intent.state.kind]);
  const dirty = JSON.stringify(input) !== savedInput;
  useUnsavedScenario(dirty || intent.unresolved);
  const disabled = !fresh || !management || intent.busy || intent.unresolved;
  return (
    <section
      aria-label="Scenario editor"
      className="space-y-5 rounded-lg border bg-white p-5"
    >
      <header>
        <h2 className="text-lg font-semibold">
          {draft ? "Edit saved scenario" : "New scenario draft"}
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          {draft
            ? `Revision ${baseRevision} · latest read ${draft.revision}`
            : "Save assumptions before enqueueing a run."}{" "}
          · {dirty ? "Unsaved changes — memory only" : "No unsaved changes"}
        </p>
      </header>
      {!management ? (
        <Dependency title="Read-only role">
          OPERATOR and VIEWER can inspect saved scenarios.
          Creating/editing/running requires ADMIN or ENGINEER.
        </Dependency>
      ) : null}
      {changedRevision ? (
        <Dependency title="Draft revision changed">
          Your form still uses revision {baseRevision}. The latest read is{" "}
          {draft?.revision}. Review the new saved values before deciding whether
          to keep this draft. No automatic rebase occurs.
          <button
            className="dss-secondary ml-3"
            disabled={!fresh || intent.unresolved}
            onClick={() => setBaseRevision(draft?.revision)}
          >
            I reviewed the latest saved revision
          </button>
        </Dependency>
      ) : null}
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || changedRevision) return;
          try {
            setError(undefined);
            setReview(validateDraft(input, snapshot));
          } catch (failure: unknown) {
            setError(scenarioError(failure));
          }
        }}
      >
        <fieldset disabled={disabled} className="grid gap-4 lg:grid-cols-2">
          <Field label="Scenario name">
            <input
              className={scenarioInput}
              required
              maxLength={160}
              value={input.name}
              onChange={(event) =>
                setInput((old) => ({ ...old, name: event.target.value }))
              }
            />
          </Field>
          <Field label="Scenario note">
            <textarea
              aria-label="Scenario note"
              className={`${scenarioInput} py-2`}
              rows={2}
              maxLength={4000}
              value={input.note}
              onChange={(event) =>
                setInput((old) => ({ ...old, note: event.target.value }))
              }
            />
          </Field>
        </fieldset>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Assumption template">
              <select
                aria-label="Assumption template"
                disabled={disabled}
                className={scenarioInput}
                value={template}
                onChange={(event) =>
                  setTemplate(event.target.value as Override["type"])
                }
              >
                <option value="MAINTENANCE_DURATION">
                  Maintenance duration
                </option>
                <option value="TECHNICIAN_UNAVAILABLE">
                  Technician unavailable
                </option>
                <option value="DEFER_MAINTENANCE">Defer maintenance</option>
              </select>
            </Field>
            <button
              type="button"
              className="dss-secondary"
              disabled={
                disabled ||
                input.overrides.length >= 5 ||
                (template === "TECHNICIAN_UNAVAILABLE"
                  ? !snapshot.technicians?.length
                  : !eligibleRequests.length)
              }
              onClick={() => {
                const override: Override =
                  template === "TECHNICIAN_UNAVAILABLE"
                    ? {
                        type: template,
                        technician_id: snapshot.technicians![0].technician_id,
                        start_at: snapshot.planning_window.start_at,
                        end_at: snapshot.planning_window.end_at,
                      }
                    : template === "MAINTENANCE_DURATION"
                      ? {
                          type: template,
                          maintenance_request_id:
                            eligibleRequests[0].maintenance_request_id,
                          expected_duration_minutes:
                            eligibleRequests[0].expected_duration_minutes,
                        }
                      : {
                          type: template,
                          maintenance_request_id:
                            eligibleRequests[0].maintenance_request_id,
                          earliest_start_at:
                            eligibleRequests[0].earliest_start_at ??
                            snapshot.planning_window.start_at,
                        };
                setInput((old) => ({
                  ...old,
                  overrides: [...old.overrides, override],
                }));
              }}
            >
              Add assumption
            </button>
            <p className="text-xs text-slate-500">
              {input.overrides.length}/5 · one override per type/target
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Pinned planning window: {snapshot.planning_window.start_at} →{" "}
            {snapshot.planning_window.end_at}. Times are entered in UTC. Target
            options come from this exact baseline, not user accounts.
          </p>
          {input.overrides.map((override, index) => (
            <OverrideFields
              key={index}
              index={index}
              value={override}
              disabled={disabled}
              snapshot={snapshot}
              onRemove={() =>
                setInput((old) => ({
                  ...old,
                  overrides: old.overrides.filter((_item, i) => i !== index),
                }))
              }
              onChange={(value) =>
                setInput((old) => ({
                  ...old,
                  overrides: old.overrides.map((item, i) =>
                    i === index ? value : item,
                  ),
                }))
              }
            />
          ))}
          {!input.overrides.length ? (
            <p className="rounded border border-dashed p-4 text-sm text-slate-500">
              No override. Add an assumption or save an objectives-only
              scenario.
            </p>
          ) : null}
        </div>
        <WeightFields
          value={input.objective_weights}
          disabled={disabled}
          onChange={(weights) =>
            setInput((old) => ({ ...old, objective_weights: weights }))
          }
        />
        {error ? <ScenarioFailure error={error} /> : null}
        <button
          className="dss-primary"
          disabled={disabled || changedRevision}
          type="submit"
        >
          Review draft changes
        </button>
      </form>
      {intent.state.error ? (
        <ScenarioFailure error={intent.state.error} />
      ) : null}
      {intent.state.kind === "uncertain" ? (
        <Dependency title="Save outcome unconfirmed">
          <p>
            The original key/body/revision is retained in memory. Hard reload
            discards it; reconcile saved drafts first.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              className="dss-primary"
              disabled={!fresh || intent.busy}
              onClick={intent.retry}
            >
              Retry original save
            </button>
            <button className="dss-secondary" onClick={refresh}>
              Refresh saved drafts
            </button>
          </div>
        </Dependency>
      ) : null}
      {intent.state.kind === "rejected" ? (
        <button
          className="dss-secondary"
          disabled={!fresh}
          onClick={() => {
            setBaseRevision(draft?.revision);
            intent.reviewed();
          }}
        >
          I reviewed the refreshed draft
        </button>
      ) : null}
      <ScenarioDialog
        title="Review scenario draft"
        open={Boolean(review)}
        fresh={fresh}
        busy={intent.busy}
        onClose={() => setReview(undefined)}
        confirmLabel="Save reviewed draft"
        onConfirm={() => {
          if (!review || disabled || changedRevision) return;
          intent.start(
            draft ? { ...review, expected_revision: baseRevision! } : review,
          );
        }}
      >
        {review ? (
          <DraftReview
            draft={review}
            workspace={workspace}
            snapshot={snapshot}
          />
        ) : null}
      </ScenarioDialog>
    </section>
  );
}
