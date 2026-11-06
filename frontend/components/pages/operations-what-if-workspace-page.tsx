"use client";

import { Beaker, CheckCircle2, Play, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { formatDateTime } from "@/lib/operations/format";
import { getWhatIfScenarios, type WhatIfScenarioFixture, type WhatIfScenarioId } from "@/lib/operations/what-if-fixtures";
import type { PlanKPIs } from "@/types/operations";

const metricRows: Array<{
  key: keyof PlanKPIs;
  label: string;
  format: (value: number) => string;
}> = [
  { key: "makespan_minutes", label: "Makespan", format: (value) => `${value} min` },
  { key: "total_tardiness_minutes", label: "Total tardiness", format: (value) => `${value} min` },
  { key: "on_time_completion_rate", label: "On-time completion", format: (value) => `${Math.round(value * 100)}%` },
  { key: "expected_failure_count", label: "Expected failures", format: (value) => value.toFixed(2) },
  { key: "failure_probability", label: "Failure probability", format: (value) => `${Math.round(value * 100)}%` },
  { key: "expected_emergency_downtime_minutes", label: "Emergency downtime", format: (value) => `${value} min` },
  { key: "maintenance_cost", label: "Maintenance cost", format: (value) => `$${value.toLocaleString("en-US")}` },
  { key: "technician_utilization", label: "Technician utilization", format: (value) => `${Math.round(value * 100)}%` },
  { key: "schedule_changes", label: "Schedule changes", format: (value) => String(value) },
];

function EventTrace({ scenario }: { scenario: WhatIfScenarioFixture }) {
  const orderedEvents = [...scenario.events].sort((left, right) => left.sequence - right.sequence);
  return (
    <ol className="divide-y divide-[var(--color-stone-border)]">
      {orderedEvents.map((event) => (
        <li key={event.event_id} className="grid grid-cols-[32px_1fr_auto] gap-3 px-4 py-3 sm:px-5">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-[var(--color-ash-gray)]">#{event.sequence}</span>
              <span className="break-all text-sm font-semibold text-[var(--color-slate-text)]">{event.event_type}</span>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-[var(--color-ash-gray)]">{event.subject_id}</p>
          </div>
          <time dateTime={event.occurred_at} className="hidden text-[11px] text-[var(--color-ash-gray)] sm:block">{formatDateTime(event.occurred_at)}</time>
        </li>
      ))}
    </ol>
  );
}

export function WhatIfWorkspacePage({ fixtures = getWhatIfScenarios() }: { fixtures?: WhatIfScenarioFixture[] }) {
  const [selectedId, setSelectedId] = useState<WhatIfScenarioId>(fixtures[0]?.scenario_id ?? "machine-unavailable");
  const [completedId, setCompletedId] = useState<WhatIfScenarioId | null>(null);
  const selected = fixtures.find((scenario) => scenario.scenario_id === selectedId) ?? fixtures[0];
  const completed = fixtures.find((scenario) => scenario.scenario_id === completedId) ?? null;

  return (
    <OperationsShell
      title="What-if Workspace"
      description="Compare simulator-returned outcomes without changing the committed schedule."
      actions={<span className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"><Beaker className="h-4 w-4" />SIMULATION ONLY</span>}
    >
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <OperationsPanel title="Scenario" description="Presets are fixture inputs for the future scenario adapter.">
            <div className="grid gap-2 p-4 sm:p-5">
              {fixtures.map((scenario) => {
                const active = scenario.scenario_id === selectedId;
                return (
                  <button
                    key={scenario.scenario_id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setSelectedId(scenario.scenario_id); setCompletedId(null); }}
                    className={`rounded-md border p-3 text-left transition-colors ${active ? "border-sky-300 bg-sky-50" : "border-[var(--color-stone-border)] bg-white hover:bg-stone-50"}`}
                  >
                    <span className="block text-sm font-semibold text-[var(--color-slate-text)]">{scenario.name}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--color-ash-gray)]">{scenario.description}</span>
                  </button>
                );
              })}
            </div>
          </OperationsPanel>

          {selected ? (
            <OperationsPanel title="Simulator overrides" description="Values are sent as scenario assumptions; the browser does not calculate an outcome.">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:p-5">
                {selected.overrides.map((override) => <div key={override.label}><dt className="text-[11px] text-[var(--color-ash-gray)]">{override.label}</dt><dd className="mt-0.5 text-sm font-medium text-[var(--color-slate-text)]">{override.value}</dd></div>)}
              </dl>
              <div className="flex gap-2 border-t border-[var(--color-stone-border)] p-4 sm:p-5">
                <button type="button" onClick={() => setCompletedId(selected.scenario_id)} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-[var(--color-slate-text)] px-4 text-sm font-semibold text-white"><Play className="h-4 w-4" />Run fixture</button>
                <button type="button" aria-label="Clear simulation result" title="Clear simulation result" onClick={() => setCompletedId(null)} disabled={!completed} className="grid h-10 w-10 place-items-center rounded-md border border-[var(--color-stone-border)] bg-white disabled:opacity-40"><RotateCcw className="h-4 w-4" /></button>
              </div>
            </OperationsPanel>
          ) : null}
        </div>

        {!completed ? (
          <div className="grid min-h-[520px] place-items-center rounded-lg border border-dashed border-[var(--color-stone-border)] bg-white p-8 text-center">
            <div><Beaker className="mx-auto h-7 w-7 text-[var(--color-steel-gray)]" /><h2 className="mt-3 text-base font-semibold">No simulation result</h2><p className="mt-1 text-sm text-[var(--color-ash-gray)]">Choose a scenario and run its contract-shaped fixture.</p></div>
          </div>
        ) : (
          <div className="min-w-0 space-y-5" aria-live="polite">
            <OperationsPanel title="Baseline vs simulated plan" description={`${completed.run_id} · seed ${completed.seed} · candidate ${completed.result.candidate_plan_id}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-stone-border)] px-4 py-3 sm:px-5">
                <OperationsStatus value={completed.result.strategy} />
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-ash-gray)]"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />Validation <strong className="text-[var(--color-slate-text)]">{completed.result.validation?.verdict ?? "NOT_RETURNED"}</strong></span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                  <thead><tr className="border-b border-[var(--color-stone-border)] text-xs text-[var(--color-ash-gray)]"><th className="px-4 py-2 font-medium sm:px-5">Metric</th><th className="px-4 py-2 font-medium">Baseline</th><th className="px-4 py-2 font-medium sm:px-5">Simulated</th></tr></thead>
                  <tbody>{metricRows.map((metric) => <tr key={metric.key} className="border-b border-[var(--color-stone-border)] last:border-b-0"><th scope="row" className="px-4 py-3 font-medium text-[var(--color-slate-text)] sm:px-5">{metric.label}</th><td className="px-4 py-3 font-mono text-xs text-[var(--color-ash-gray)]">{metric.format(completed.baseline_kpis[metric.key] ?? 0)}</td><td className="px-4 py-3 font-mono text-xs font-semibold text-[var(--color-slate-text)] sm:px-5">{metric.format(completed.result.kpis[metric.key] ?? 0)}</td></tr>)}</tbody>
                </table>
              </div>
            </OperationsPanel>

            {completed.result.warnings.length ? <div className="rounded-md border border-amber-200 bg-amber-50 p-4"><h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950"><TriangleAlert className="h-4 w-4" />Returned warnings</h2><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">{completed.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}

            <OperationsPanel title="Simulation trace" description="Events are displayed in backend-authoritative sequence order.">
              <EventTrace scenario={completed} />
            </OperationsPanel>

            <p className="rounded-md border border-[var(--color-stone-border)] bg-stone-50 p-3 text-xs text-[var(--color-ash-gray)]">This result is isolated from the live workflow. A SIMULATION_ONLY Decision Case cannot create a committed schedule.</p>
          </div>
        )}
      </div>
    </OperationsShell>
  );
}
