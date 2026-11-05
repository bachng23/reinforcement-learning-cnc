"use client";
import { useState } from "react";
import type {
  SensitivityResult,
  EvaluationResult,
  MetricComparison,
} from "@/types/generated/scenario-planning";
import {
  EvaluationDetails,
  MetricTable,
  SamplingDetails,
  type ResultSelection,
  type SelectResult,
} from "./engine-result";
import { Field, IdentityDetails, scenarioInput } from "./frame";

export function SensitivityResultView({
  result,
  source,
  selection,
  onSelection,
}: {
  result: SensitivityResult;
  source?: EvaluationResult;
  selection: ResultSelection;
  onSelection?: SelectResult;
}) {
  const [localPoint, setLocalPoint] = useState<string>();
  const [localMetric, setLocalMetric] = useState<string>();
  const definitions = [
    ...new Map(
      result.points
        .flatMap((point) => point.comparison.metrics)
        .map((metric) => [metric.metric, metric]),
    ).values(),
  ];
  const metricName = selection.metric ?? localMetric ?? definitions[0]?.metric;
  const definition = definitions.find((metric) => metric.metric === metricName);
  const selectedValue =
    selection.point ??
    localPoint ??
    String(result.requested_order[0] ?? result.points[0]?.value);
  const selected = result.points.find(
    (point) => String(point.value) === selectedValue,
  );
  const pick = (value: number) =>
    onSelection
      ? onSelection({ point: String(value), candidate_id: undefined })
      : setLocalPoint(String(value));
  if (
    source &&
    (source.identity.run_id !== result.identity.run_id ||
      source.identity.workspace_id !== result.identity.workspace_id ||
      source.identity.frozen_input_hash !== result.identity.frozen_input_hash)
  )
    return (
      <p role="alert">
        Sensitivity source does not match its frozen result. Chart and point
        drill-down are withheld.
      </p>
    );
  return (
    <section
      aria-label="Evaluated sensitivity"
      className="min-w-0 space-y-6 rounded-lg border bg-white p-5"
    >
      <header className="space-y-2">
        <h3 className="text-xl font-semibold">Sensitivity results</h3>
        <p role="status">
          Aggregate: <strong>{result.outcome}</strong> · baseline value{" "}
          {result.baseline_value}
          {result.axis.type === "MAINTENANCE_DURATION"
            ? " minutes"
            : " raw weight"}
        </p>
        <p className="text-sm text-slate-600">
          Requested order: {result.requested_order.join(", ")}. Each sample
          retains its own evaluation and constraint outcome.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Sensitivity chart KPI">
          <select
            className={scenarioInput}
            value={metricName ?? ""}
            onChange={(event) =>
              onSelection
                ? onSelection({ metric: event.target.value })
                : setLocalMetric(event.target.value)
            }
          >
            {definitions.map((metric) => (
              <option key={metric.metric} value={metric.metric}>
                {metric.metric.replaceAll("_", " ")} ({metric.unit};{" "}
                {metric.preferred_direction})
              </option>
            ))}
          </select>
        </Field>
        <div className="rounded border bg-slate-50 p-4 text-sm">
          <strong>Fixed inputs returned by the engine</strong>
          <ul className="mt-2 list-disc break-words pl-5">
            {result.fixed_inputs.length ? (
              result.fixed_inputs.map((item, i) => <li key={i}>{item}</li>)
            ) : (
              <li>Not provided</li>
            )}
          </ul>
        </div>
      </div>
      {definition ? (
        <SampleChart
          result={result}
          definition={definition}
          selectedValue={selectedValue}
          onPoint={pick}
        />
      ) : (
        <p role="status">
          No KPI definition or series was supplied for this chart.
        </p>
      )}
      <div
        className="max-h-[460px] overflow-auto rounded-lg border"
        tabIndex={0}
        role="region"
        aria-label="Sensitivity point records"
      >
        <table
          className="w-full min-w-[850px] text-left text-sm"
          aria-label="Sensitivity samples"
        >
          <thead className="sticky top-0 bg-slate-100">
            <tr>
              {[
                "Sample",
                "Outcome",
                "Selected strategy",
                "KPI / unit",
                "Raw / delta / percent",
                "Reason / constraints",
              ].map((label) => (
                <th className="p-3" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.points.map((point) => {
              const metric = point.comparison.metrics.find(
                (item) => item.metric === metricName,
              );
              const candidate = point.evaluation.candidates?.find(
                (item) =>
                  item.candidate_plan_id ===
                  point.evaluation.selected_candidate_id,
              );
              return (
                <tr
                  key={point.value}
                  className={
                    String(point.value) === selectedValue ? "bg-blue-50" : ""
                  }
                >
                  <th className="p-3">
                    <button
                      className="text-blue-800 underline underline-offset-4"
                      aria-label={`Inspect sensitivity sample ${point.value}`}
                      aria-pressed={String(point.value) === selectedValue}
                      onClick={() => pick(point.value)}
                    >
                      {point.value}
                    </button>
                    {point.value === result.baseline_value ? (
                      <span className="mt-1 block text-xs">
                        Baseline sample
                      </span>
                    ) : null}
                  </th>
                  <td className="p-3">
                    {point.status}
                    {point.evaluation.partial ? " · partial" : ""}
                  </td>
                  <td className="p-3">
                    {candidate?.strategy ?? "Not available"}
                  </td>
                  <td className="p-3 text-xs">
                    {metric
                      ? `${metric.metric} / ${metric.unit}`
                      : "Not provided"}
                  </td>
                  <td className="p-3 tabular-nums">
                    {metric?.scenario ?? "Not available"} /{" "}
                    {metric?.absolute_delta ?? "Not available"} /{" "}
                    {metric?.percent_delta == null
                      ? "Not available"
                      : `${metric.percent_delta}%`}
                  </td>
                  <td className="max-w-80 break-words p-3 text-xs">
                    {metric?.reason ?? metric?.change ?? "Not provided"}
                    {(point.evaluation.diagnostics ?? []).map((item, i) => (
                      <p className="mt-1" key={i}>
                        {item.code}: {item.message}
                      </p>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section
        aria-label="Sampled rank changes"
        className="space-y-2 rounded border border-amber-200 bg-amber-50 p-4 text-sm"
      >
        <h4 className="font-semibold">Sampled rank-change intervals</h4>
        {result.rank_change_intervals.length ? (
          <ul className="space-y-2">
            {result.rank_change_intervals.map((interval, i) => (
              <li key={i}>
                {interval.lower_sample} → {interval.upper_sample}:{" "}
                {interval.from_strategy} → {interval.to_strategy}. Sampled
                interval, not an exact threshold.
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No rank change was reported between adjacent feasible samples. This
            does not establish optimality between or beyond the sampled values.
          </p>
        )}
        <p>
          Infeasible, failed and timeout samples remain gaps; the browser does
          not interpolate their KPI.
        </p>
      </section>
      {selected ? (
        <section aria-label="Selected sensitivity sample" className="space-y-5">
          <h4 className="text-lg font-semibold">
            Sample {selected.value} · {selected.status}
          </h4>
          <MetricTable comparison={selected.comparison} />
          <EvaluationDetails
            key={selected.value}
            value={selected.evaluation}
            snapshot={source?.effective.snapshot}
            comparison={selected.comparison}
            candidateId={selection.candidate_id}
            onCandidate={
              onSelection
                ? (id) => onSelection({ candidate_id: id })
                : undefined
            }
            label={`Sample ${selected.value} candidate preview`}
          />
          <p className="text-xs text-slate-500">
            Resource names and priority context come from the frozen source run.
            The selected sample supplies its own schedule times, KPI and
            constraints; no new run is submitted when inspecting a point.
          </p>
        </section>
      ) : (
        <p role="alert">
          The point in the URL is not part of this saved sensitivity result.
          Choose a supplied sample.
        </p>
      )}
      <SamplingDetails sampling={result.sampling} />
      <IdentityDetails
        values={{
          "Source run": result.identity.run_id,
          "Source input hash": result.identity.frozen_input_hash,
          Engine: result.engine_version,
          Contract: result.contract_version,
        }}
      />
    </section>
  );
}

function SampleChart({
  result,
  definition,
  selectedValue,
  onPoint,
}: {
  result: SensitivityResult;
  definition: MetricComparison;
  selectedValue: string;
  onPoint: (value: number) => void;
}) {
  const points = [...result.points].sort(
    (left, right) => left.value - right.value,
  );
  const values = points.map((point) => ({
    point,
    metric: point.comparison.metrics.find(
      (metric) => metric.metric === definition.metric,
    ),
  }));
  if (
    values.some(
      (item) =>
        item.metric &&
        (item.metric.unit !== definition.unit ||
          item.metric.preferred_direction !== definition.preferred_direction),
    )
  )
    return (
      <p role="alert">
        Metric definitions differ between samples; chart rendering is refused.
      </p>
    );
  const available = values.filter(
    (item) => item.point.status === "FEASIBLE" && item.metric?.scenario != null,
  );
  if (!available.length)
    return (
      <p role="status" className="rounded border bg-amber-50 p-5">
        No feasible KPI samples are available to plot. Point outcomes and
        constraints are retained below.
      </p>
    );
  // Only SVG coordinates are calculated here. All metric values, deltas, ranks,
  // normalization and feasibility remain exactly as returned by the engine.
  const minimumX = Math.min(
    result.baseline_value,
    ...points.map((point) => point.value),
  );
  const maximumX = Math.max(
    result.baseline_value,
    ...points.map((point) => point.value),
  );
  const minimumY = Math.min(...available.map((item) => item.metric!.scenario!));
  const maximumY = Math.max(...available.map((item) => item.metric!.scenario!));
  const x = (value: number) =>
    maximumX === minimumX
      ? 540
      : 110 + ((value - minimumX) / (maximumX - minimumX)) * 880;
  const y = (value: number) =>
    maximumY === minimumY
      ? 215
      : 350 - ((value - minimumY) / (maximumY - minimumY)) * 260;
  // Axis ticks are display geometry, not interpolated engine observations.
  // Uniform ticks keep nearby samples (for example 90 and 91) readable.
  const xTicks =
    maximumX === minimumX
      ? [minimumX]
      : Array.from(
          { length: 5 },
          (_, index) => minimumX + ((maximumX - minimumX) * index) / 4,
        );
  const yTicks = maximumY === minimumY ? [minimumY] : [minimumY, maximumY];
  const segments: string[][] = [];
  let segment: string[] = [];
  for (const item of values) {
    if (item.point.status !== "FEASIBLE" || item.metric?.scenario == null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push(`${x(item.point.value)},${y(item.metric.scenario)}`);
  }
  if (segment.length) segments.push(segment);
  const axis =
    result.axis.type === "MAINTENANCE_DURATION"
      ? "Maintenance duration (minutes)"
      : `${result.axis.weight.replaceAll("_", " ")} (raw weight)`;
  return (
    <figure className="rounded-lg border bg-slate-50 p-4">
      <figcaption className="mb-3 font-semibold">
        {definition.metric.replaceAll("_", " ")} — {definition.unit}; preferred{" "}
        {definition.preferred_direction}
      </figcaption>
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Sensitivity chart"
      >
        <svg
          className="h-auto min-w-[800px] w-full"
          viewBox="0 0 1080 470"
          role="img"
          aria-label={`${definition.metric} sensitivity samples; ${axis}`}
        >
          <title>
            Saved sensitivity samples with infeasible gaps and baseline marker
          </title>
          <line x1="110" y1="350" x2="1000" y2="350" stroke="#64748b" />
          <line x1="110" y1="70" x2="110" y2="350" stroke="#64748b" />
          <text x="110" y="38" fontSize="15">
            {definition.unit} ({definition.preferred_direction})
          </text>
          {yTicks.map((value) => (
            <text
              key={value}
              x="100"
              y={y(value) + 4}
              textAnchor="end"
              fontSize="13"
            >
              {value}
            </text>
          ))}
          {xTicks.map((value) => (
            <text
              key={value}
              x={x(value)}
              y="384"
              textAnchor="middle"
              fontSize="13"
            >
              {new Intl.NumberFormat("en", {
                maximumSignificantDigits: 6,
              }).format(value)}
            </text>
          ))}
          <line
            x1={x(result.baseline_value)}
            x2={x(result.baseline_value)}
            y1="62"
            y2="350"
            stroke="#7c3aed"
            strokeDasharray="6 5"
          />
          <text
            x={x(result.baseline_value)}
            y="57"
            textAnchor="middle"
            fill="#6d28d9"
            fontSize="13"
          >
            Baseline {result.baseline_value}
          </text>
          {segments.map((items, i) => (
            <polyline
              key={i}
              data-testid="feasible-sample-segment"
              points={items.join(" ")}
              fill="none"
              stroke="#1d4ed8"
              strokeWidth="3"
            />
          ))}
          {values.map(({ point, metric }) => {
            const hasValue =
              point.status === "FEASIBLE" && metric?.scenario != null;
            return (
              <g key={point.value}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect chart sample ${point.value}: ${point.status}`}
                  onClick={() => onPoint(point.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPoint(point.value);
                    }
                  }}
                  className="cursor-pointer focus:outline-blue-700"
                >
                  <title>
                    {point.value}: {point.status}
                    {hasValue
                      ? `; ${metric!.scenario} ${definition.unit}`
                      : "; no metric value plotted"}
                  </title>
                  {hasValue ? (
                    <circle
                      cx={x(point.value)}
                      cy={y(metric!.scenario!)}
                      r={String(point.value) === selectedValue ? 9 : 6}
                      fill="#1d4ed8"
                      stroke="white"
                      strokeWidth="2"
                    />
                  ) : (
                    <path
                      data-testid="infeasible-gap"
                      d={`M ${x(point.value) - 6} 330 l 12 12 m -12 0 l 12 -12`}
                      stroke="#b45309"
                      strokeWidth="3"
                    />
                  )}
                </g>
              </g>
            );
          })}
          <text x="550" y="430" textAnchor="middle" fontSize="15">
            {axis}
          </text>
        </svg>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Lines connect adjacent feasible samples only. Amber crosses mark
        unavailable samples without assigning them a KPI value. No confidence
        band or exact breakpoint is inferred.
      </p>
    </figure>
  );
}
