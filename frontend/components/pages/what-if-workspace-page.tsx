"use client";

import {
  CheckCircle2,
  FlaskConical,
  Play,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { DataNotice } from "@/components/research/data-notice";
import { PageHeader } from "@/components/research/page-header";
import { scenarioPresets } from "@/lib/operations-ui/fixtures";
import type { ScenarioPreset, SimulationResult } from "@/types/operations-ui";

export function WhatIfWorkspacePage({
  presets = scenarioPresets,
}: {
  presets?: ScenarioPreset[];
}) {
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? "");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const selected =
    presets.find((preset) => preset.id === selectedId) ?? presets[0];
  return (
    <AppShell title="What-if Workspace">
      <main className="dss-page">
        <PageHeader
          title="What-if Workspace"
          description="Compare operational tradeoffs before committing to a maintenance decision."
        />
        <DataNotice simulation />
        <div className="scenario-workspace">
          <section
            className="dss-panel scenario-setup"
            aria-labelledby="scenario-heading"
          >
            <div className="section-heading">
              <div>
                <h2 id="scenario-heading">Scenario</h2>
                <p>Choose an assumption to test.</p>
              </div>
            </div>
            <div className="scenario-options">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selectedId === preset.id}
                  className={`scenario-option ${selectedId === preset.id ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedId(preset.id);
                    setResult(null);
                  }}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.description}</span>
                </button>
              ))}
            </div>
            {selected && (
              <div className="scenario-assumptions">
                <h3>Assumptions</h3>
                <dl>
                  {selected.inputs.map((input) => (
                    <div key={input.label}>
                      <dt>{input.label}</dt>
                      <dd>{input.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className="scenario-actions">
              <button
                type="button"
                className="primary-action"
                disabled={!selected}
                onClick={() => {
                  if (selected) setResult(selected.result);
                }}
              >
                <Play size={16} aria-hidden="true" />
                Run scenario
              </button>
              <button
                type="button"
                className="secondary-action"
                aria-label="Clear simulation result"
                title="Clear simulation result"
                disabled={!result}
                onClick={() => setResult(null)}
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="scenario-mode-note">
              Demo mode displays a recorded result for the selected scenario.
            </p>
          </section>
          <section
            className="dss-panel scenario-results"
            aria-live="polite"
            aria-labelledby="result-heading"
          >
            {!result ? (
              <div className="scenario-empty">
                <FlaskConical size={36} aria-hidden="true" />
                <h2 id="result-heading">No simulation result</h2>
                <p>
                  Select a scenario to compare production time, failure exposure
                  and technician utilization.
                </p>
                <div className="scenario-empty-metrics">
                  <span>Production impact</span>
                  <span>Failure exposure</span>
                  <span>Resource utilization</span>
                </div>
              </div>
            ) : (
              <>
                <div className="section-heading">
                  <div>
                    <h2 id="result-heading">Baseline vs simulated plan</h2>
                    <p>{selected?.name}</p>
                  </div>
                  <span className="scenario-verdict">
                    <ShieldCheck size={16} aria-hidden="true" />
                    {result.verdict}
                  </span>
                </div>
                <div className="scenario-result-context">
                  <span>{result.strategy.replaceAll("_", " ")}</span>
                  <span>
                    Run {result.runId} · Seed {result.seed}
                  </span>
                </div>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Scenario comparison data"
                >
                  <table className="dss-table scenario-table">
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        <th scope="col">Baseline</th>
                        <th scope="col">Simulated</th>
                        <th scope="col">Interpretation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.metrics.map((metric) => (
                        <tr key={metric.label}>
                          <th scope="row">{metric.label}</th>
                          <td>{metric.baseline}</td>
                          <td
                            className={`metric-outcome outcome-${metric.tone}`}
                          >
                            {metric.simulated}
                          </td>
                          <td>
                            <span
                              className={`outcome-label outcome-${metric.tone}`}
                            >
                              {metric.tone === "positive"
                                ? "Favorable tradeoff"
                                : metric.tone === "negative"
                                  ? "Needs consideration"
                                  : "Context dependent"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.warnings.length > 0 && (
                  <div className="scenario-warnings">
                    <h3>
                      <TriangleAlert size={17} aria-hidden="true" />
                      Assumptions and warnings
                    </h3>
                    <ul>
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <details className="scenario-trace" open>
                  <summary>Simulation trace</summary>
                  <ol>
                    {result.eventSequence.map((event) => (
                      <li key={event.eventId}>
                        <CheckCircle2 size={17} aria-hidden="true" />
                        <div>
                          <strong>{event.title}</strong>
                          <p>{event.summary}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </details>
                <p className="scenario-mode-note">
                  Candidate {result.candidatePlanId}. This result cannot create
                  a committed schedule.
                </p>
              </>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
