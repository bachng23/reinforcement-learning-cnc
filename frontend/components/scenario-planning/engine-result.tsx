"use client";
import { useState } from "react";
import type {
  EngineResult,
  Evaluation,
  EvaluationResult,
  Comparison,
  FactorySnapshot,
  SamplingEvidence,
} from "@/types/generated/scenario-planning";
import type { ScenarioSelection } from "@/lib/scenario-planning/navigation";
import { ScheduleGantt } from "@/components/operations/schedule-gantt";
import { IdentityDetails } from "./frame";
import { SensitivityResultView } from "./sensitivity-result";

export type ResultSelection = Pick<
  ScenarioSelection,
  "candidate_id" | "point" | "metric"
>;
export type SelectResult = (patch: Partial<ResultSelection>) => void;
const raw = (value: number | null | undefined) =>
  value == null ? "Not available" : String(value);
const changeTone = {
  IMPROVED_UNDER_MODEL: "text-emerald-800",
  WORSENED_UNDER_MODEL: "text-rose-800",
  UNCHANGED: "text-slate-700",
  UNAVAILABLE: "text-slate-500",
};

export function MetricTable({ comparison }: { comparison: Comparison }) {
  return (
    <div className="space-y-3">
      <div
        className="max-h-[480px] overflow-auto rounded-lg border"
        tabIndex={0}
        role="region"
        aria-label="KPI comparison records"
      >
        <table
          className="w-full min-w-[850px] text-left text-sm"
          aria-label="Computed KPI comparison"
        >
          <thead className="sticky top-0 z-10 bg-slate-100">
            <tr>
              {[
                "KPI / unit",
                "Preferred direction",
                "Baseline",
                "Scenario",
                "Absolute delta",
                "Percent delta",
                "Model result / reason",
              ].map((label) => (
                <th key={label} className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparison.metrics.map((metric) => (
              <tr key={metric.metric}>
                <th className="max-w-56 break-words p-3 font-medium">
                  {metric.metric.replaceAll("_", " ")}
                  <span className="mt-1 block text-xs text-slate-500">
                    {metric.unit}
                  </span>
                </th>
                <td className="p-3 text-xs">{metric.preferred_direction}</td>
                <td className="p-3 tabular-nums">{raw(metric.baseline)}</td>
                <td className="p-3 tabular-nums">{raw(metric.scenario)}</td>
                <td className={`p-3 tabular-nums ${changeTone[metric.change]}`}>
                  {raw(metric.absolute_delta)}
                </td>
                <td className="p-3 tabular-nums">
                  {metric.percent_delta == null
                    ? "Not available"
                    : `${metric.percent_delta}%`}
                </td>
                <td
                  className={`max-w-80 break-words p-3 text-xs ${changeTone[metric.change]}`}
                >
                  {metric.change.replaceAll("_", " ")}
                  <p className="mt-1 text-slate-600">
                    {metric.reason ?? "No additional reason supplied"}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!comparison.metrics.length ? (
          <p className="p-4 text-sm">No metric rows provided.</p>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">
        Values, units, deltas and direction verdicts are returned by the engine.
        Scores use their own candidate set/reference; cross-run score
        differences are not absolute quality comparisons.
      </p>
      <ModelAssumptions assumptions={comparison.model_assumptions} />
    </div>
  );
}

export function ModelAssumptions({ assumptions }: { assumptions: string[] }) {
  return (
    <aside
      aria-label="Model assumptions"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <h3 className="font-semibold">
        Model assumptions affecting these estimates
      </h3>
      {assumptions.length ? (
        <ul className="mt-2 list-disc space-y-1 break-words pl-5">
          {assumptions.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2">Not provided by the engine.</p>
      )}
    </aside>
  );
}
export function SamplingDetails({ sampling }: { sampling: SamplingEvidence }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        Sampling model: {sampling.version}; {sampling.sample_count} draws; seed{" "}
        {sampling.base_seed}; coupling {sampling.coupling}.
      </p>
      <p className="text-xs text-slate-500">
        Monte Carlo sample count describes the simulation model. No
        rank-confidence probability or confidence interval is provided by this
        contract.
      </p>
      <IdentityDetails
        values={{
          "Sampling algorithm": sampling.algorithm,
          "Observation set": sampling.observation_set_hash,
          "Coupling key": sampling.coupling_key,
        }}
      />
    </div>
  );
}

export function EvaluationDetails({
  value,
  snapshot,
  comparison,
  candidateId,
  onCandidate,
  label = "Scenario candidate preview",
}: {
  value: Evaluation;
  snapshot?: FactorySnapshot | null;
  comparison?: Comparison;
  candidateId?: string;
  onCandidate?: (id: string) => void;
  label?: string;
}) {
  const [localCandidate, setLocalCandidate] = useState<string>();
  const candidates = value.candidates ?? [];
  const activeId = candidateId ?? localCandidate ?? value.selected_candidate_id;
  const selected = candidates.find(
    (candidate) => candidate.candidate_plan_id === activeId,
  );
  const validation = selected?.validation;
  if (
    candidates.some(
      (candidate) =>
        candidate.validation?.verdict !== "VALID" ||
        candidate.validation.candidate_plan_id !== candidate.candidate_plan_id,
    )
  )
    return (
      <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-4">
        Candidate validation is missing or invalid. Candidate selection and
        schedule rendering are refused.
      </p>
    );
  return (
    <div className="min-w-0 space-y-5">
      <div
        className={`rounded-lg border p-4 ${value.outcome === "FEASIBLE" ? "bg-slate-50" : "border-amber-200 bg-amber-50"}`}
        role="status"
      >
        <strong>{value.outcome.replaceAll("_", " ")}</strong>
        {value.partial
          ? " — partial result; inspect the returned strategy outcomes and diagnostics"
          : ""}
        {value.outcome !== "FEASIBLE" ? (
          <p className="mt-2 text-sm">
            No usable candidate is supplied for this outcome. Missing KPI and
            schedules remain unavailable.
          </p>
        ) : null}
      </div>
      {(value.diagnostics ?? []).length ? (
        <section aria-label="Constraint diagnostics" className="space-y-2">
          <h3 className="font-semibold">Constraints and diagnostics</h3>
          {value.diagnostics!.map((item, i) => (
            <div key={i} className="rounded border p-3 text-sm">
              <strong>{item.code}</strong>
              <p className="mt-1 break-words">{item.message}</p>
              <p className="mt-1 break-all text-xs text-slate-500">
                {item.field ?? "No field reference"} ·{" "}
                {(item.target_ids ?? []).join(", ") || "No target references"}
              </p>
            </div>
          ))}
        </section>
      ) : null}
      {(value.candidate_availability ?? []).length ? (
        <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Strategy availability and constraints
          </summary>
          <ul className="mt-3 space-y-2">
            {value.candidate_availability!.map((item) => (
              <li key={item.strategy} className="break-words">
                {item.strategy}: <strong>{item.outcome}</strong>
                {item.reason ? ` — ${item.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {candidates.length ? (
        <fieldset className="space-y-3">
          <legend className="font-semibold">Candidate schedules</legend>
          <div className="grid gap-3 lg:grid-cols-3">
            {candidates.map((candidate) => (
              <label
                key={candidate.candidate_plan_id}
                className={`min-w-0 cursor-pointer rounded-lg border p-4 text-sm ${activeId === candidate.candidate_plan_id ? "border-blue-500 bg-blue-50" : "bg-white"}`}
              >
                <input
                  className="mr-2"
                  type="radio"
                  name={`candidate-${label}`}
                  aria-label={`Select candidate ${candidate.candidate_plan_id}`}
                  checked={activeId === candidate.candidate_plan_id}
                  onChange={() =>
                    onCandidate
                      ? onCandidate(candidate.candidate_plan_id)
                      : setLocalCandidate(candidate.candidate_plan_id)
                  }
                />
                <strong>{candidate.strategy}</strong>
                {candidate.candidate_plan_id === value.selected_candidate_id ? (
                  <span className="mt-2 block text-xs text-blue-900">
                    Engine-selected candidate
                  </span>
                ) : null}
                <span className="mt-2 block break-all font-mono text-xs">
                  {candidate.candidate_plan_id}
                </span>
                <span className="mt-2 block text-xs">
                  Plan version {candidate.plan_version} · validation{" "}
                  {candidate.validation?.verdict}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {candidateId && !selected ? (
        <p
          role="alert"
          className="rounded border border-amber-200 bg-amber-50 p-4 text-sm"
        >
          The candidate in the URL is not part of this evaluation. Choose one of
          the supplied candidates.
        </p>
      ) : null}
      {value.ranking ? (
        <section className="space-y-3" aria-label="Ranking provenance">
          <h3 className="font-semibold">
            Relative score and normalization context
          </h3>
          <p className="break-all text-xs">
            Reference: {value.ranking.normalization_reference_id} ·{" "}
            {value.ranking.version}
          </p>
          <p className="text-xs text-slate-500">
            Scores below are valid within this reference and candidate set. The
            browser preserves the engine order and does not rerank.
          </p>
          <div className="max-h-96 overflow-auto rounded border" tabIndex={0}>
            <table
              className="w-full min-w-[760px] text-left text-sm"
              aria-label="Computed strategy ranking"
            >
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {[
                    "Strategy / candidate",
                    "Relative score",
                    "Normalized contributions",
                    "Ties",
                  ].map((item) => (
                    <th className="p-3" key={item}>
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {value.ranking.rows.map((row) => (
                  <tr
                    key={row.candidate_plan_id}
                    className={
                      row.candidate_plan_id === activeId ? "bg-blue-50" : ""
                    }
                  >
                    <td className="max-w-72 break-all p-3">
                      {row.strategy}
                      <span className="mt-1 block font-mono text-xs">
                        {row.candidate_plan_id}
                      </span>
                    </td>
                    <td className="p-3 tabular-nums">{row.score}</td>
                    <td className="p-3 text-xs">
                      {Object.entries(row.weighted_contributions).map(
                        ([key, amount]) => (
                          <p className="break-words" key={key}>
                            {key}: {amount}
                          </p>
                        ),
                      )}
                    </td>
                    <td className="max-w-56 break-all p-3 text-xs">
                      {row.tied_with.length
                        ? row.tied_with.join(", ")
                        : "No ties returned"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 lg:grid-cols-5">
            {Object.entries(value.ranking.raw_weights).map(([key, amount]) => (
              <div className="rounded border p-3 text-xs" key={key}>
                <strong>{key.replaceAll("_", " ")}</strong>
                <p className="mt-2">Raw: {amount}</p>
                <p>
                  Normalized:{" "}
                  {value.ranking!.normalized_weights[key] ?? "Not provided"}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs">
            Tie break: {value.ranking.tie_break.join(" → ")}. Constant-range
            benefit: {value.ranking.constant_range_benefit}.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer">
              Normalization bounds returned by the engine
            </summary>
            <dl className="mt-2 grid gap-2 lg:grid-cols-3">
              {Object.entries(value.ranking.reference_bounds).map(
                ([key, bounds]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{bounds.join(" → ")}</dd>
                  </div>
                ),
              )}
            </dl>
          </details>
        </section>
      ) : null}
      {selected && validation ? (
        <section
          aria-label="Selected candidate details"
          className="space-y-4 rounded-lg border bg-white p-4"
        >
          <h3 className="font-semibold">
            Selected: {selected.strategy} · plan version {selected.plan_version}
          </h3>
          <p className="break-all text-xs">
            {selected.candidate_plan_id} · {selected.source_engine_id} /{" "}
            {selected.source_engine_version}
          </p>
          <p className="text-sm">
            Validation {validation.verdict} · validator{" "}
            {validation.validator_version} · {validation.simulation_runs}{" "}
            simulation runs.
          </p>
          <div className="max-h-96 overflow-auto" tabIndex={0}>
            <table
              className="w-full min-w-[600px] text-left text-sm"
              aria-label="Selected candidate KPI"
            >
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  <th className="p-3">Returned KPI</th>
                  <th className="p-3">Raw value</th>
                  <th className="p-3">Unit / preferred direction</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {Object.entries(selected.kpis).map(([name, amount]) => {
                  const definition = comparison?.metrics.find(
                    (metric) => metric.metric === name,
                  );
                  return (
                    <tr key={name}>
                      <th className="p-3 font-medium">
                        {name.replaceAll("_", " ")}
                      </th>
                      <td className="p-3 tabular-nums">{raw(amount)}</td>
                      <td className="p-3 text-xs">
                        {definition
                          ? `${definition.unit} / ${definition.preferred_direction}`
                          : "Not provided"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 text-sm lg:grid-cols-2">
            <div>
              <h4 className="font-medium">Assumptions</h4>
              <ul className="mt-2 list-disc space-y-1 break-words pl-5">
                {selected.assumptions?.length ? (
                  selected.assumptions.map((item, i) => <li key={i}>{item}</li>)
                ) : (
                  <li>Not provided</li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="font-medium">Warnings</h4>
              <ul className="mt-2 list-disc space-y-1 break-words pl-5">
                {[...(selected.warnings ?? []), ...(validation.warnings ?? [])]
                  .length ? (
                  [
                    ...(selected.warnings ?? []),
                    ...(validation.warnings ?? []),
                  ].map((item, i) => <li key={i}>{item}</li>)
                ) : (
                  <li>No warnings supplied</li>
                )}
              </ul>
            </div>
          </div>
          {validation.violations?.length ? (
            <ul className="space-y-2 text-sm">
              {validation.violations.map((item) => (
                <li className="break-words" key={item.violation_id}>
                  {item.severity} · {item.constraint_code}: {item.message}
                  <p className="break-all text-xs">
                    {(item.entity_refs ?? []).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {snapshot &&
          snapshot.snapshot_id === selected.snapshot_id &&
          snapshot.factory_id === selected.schedule.factory_id ? (
            <div className="min-h-[400px] min-w-0 rounded-lg border">
              <ScheduleGantt
                schedule={selected.schedule}
                snapshot={snapshot}
                label={label}
              />
            </div>
          ) : (
            <p className="rounded bg-amber-50 p-4 text-sm">
              Immutable resource context is unavailable or does not match this
              schedule. Gantt preview is withheld.
            </p>
          )}
          {!selected.schedule.assignments?.length ? (
            <p role="status" className="text-sm">
              The selected candidate contains no assignments.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const diffText = (value: unknown): string => {
  if (value === null) return "Not provided";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value))
    return value.map(diffText).join("; ") || "Empty list";
  if ("start_at" in value && "end_at" in value)
    return `${String(value.start_at)} → ${String(value.end_at)}`;
  return JSON.stringify(value);
};
export function EngineResultView({
  result,
  source,
  selection = {},
  onSelection,
}: {
  result: EngineResult;
  source?: EvaluationResult;
  selection?: ResultSelection;
  onSelection?: SelectResult;
}) {
  const [showBaseline, setShowBaseline] = useState(false);
  if ("points" in result)
    return (
      <SensitivityResultView
        result={result}
        source={source}
        selection={selection}
        onSelection={onSelection}
      />
    );
  return (
    <section aria-label="Evaluated scenario" className="min-w-0 space-y-6">
      <MetricTable comparison={result.comparison} />
      <EvaluationDetails
        value={result.scenario}
        snapshot={result.effective.snapshot}
        comparison={result.comparison}
        candidateId={selection.candidate_id}
        onCandidate={
          onSelection ? (id) => onSelection({ candidate_id: id }) : undefined
        }
      />
      <details
        className="space-y-4 rounded border p-4"
        onToggle={(event) => setShowBaseline(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-semibold">
          Computed no-overrides baseline using this run configuration
        </summary>
        <p className="text-sm">
          The engine computed this baseline with the scenario weights, model and
          sampling. It is separate from the historical publication.
        </p>
        {showBaseline ? (
          <EvaluationDetails
            value={result.baseline}
            label="Computed baseline candidate"
          />
        ) : null}
      </details>
      <section
        className="space-y-3 rounded border p-4"
        aria-label="Effective changes"
      >
        <h3 className="font-semibold">
          Effective changes returned by the engine
        </h3>
        {result.effective.diff.length ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="bg-slate-100">
                <tr>
                  {["Target / field", "Before", "Effective value"].map(
                    (item) => (
                      <th className="p-3" key={item}>
                        {item}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.effective.diff.map((diff, i) => (
                  <tr key={i}>
                    <th className="max-w-64 break-all p-3 font-medium">
                      {diff.target_id}
                      <span className="mt-1 block text-xs">{diff.field}</span>
                    </th>
                    <td className="max-w-80 break-words p-3">
                      {diffText(diff.before)}
                    </td>
                    <td className="max-w-80 break-words p-3">
                      {diffText(diff.after)}
                      {diff.field === "expected_duration_minutes"
                        ? " minutes"
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm">
            No effective override changes were returned.
          </p>
        )}
        {(result.effective.diagnostics ?? []).map((item, i) => (
          <p className="text-sm" key={i}>
            {item.code}: {item.message}
          </p>
        ))}
      </section>
      <SamplingDetails sampling={result.sampling} />
      <IdentityDetails
        values={{
          "Factory ID": result.identity.factory_id,
          "Workspace ID": result.identity.workspace_id,
          "Run ID": result.identity.run_id,
          "Frozen input hash": result.identity.frozen_input_hash,
          "Semantic input hash": result.semantic_input_hash,
          "Basis hash": result.effective.source_hash,
          "Effective hash": result.effective.effective_hash,
          Transform: result.effective.transform_version,
          Engine: result.engine_version,
          Contract: result.contract_version,
        }}
      />
    </section>
  );
}
