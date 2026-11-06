import { ChevronRight } from "lucide-react";
import {
  factoryReplayMachines,
  factoryReplaySampleTimes,
  type FactoryReplayMachine,
} from "@/lib/operations-ui/factory-replay";
import { operationsOverviewFixture } from "@/lib/operations-ui/fixtures";
import { summarizeFactory } from "@/lib/operations-ui/factory-summary";
import type { OperationsOverviewFixture } from "@/types/operations-ui";

const stateLabels = [
  ["OPERATING", "Operating normally", "operating"],
  ["RISK", "At risk", "risk"],
  ["FAULTED", "Faulted", "faulted"],
  ["MAINTENANCE", "Under maintenance", "maintenance"],
] as const;
const workLabels = [
  ["NEEDS_REVIEW", "Needs review"],
  ["ANALYZING", "AI analyzing"],
  ["MONITORING", "Monitoring"],
] as const;

export function FactoryOverview({
  onInspectMachines,
  overview = operationsOverviewFixture,
  machines = factoryReplayMachines,
}: {
  onInspectMachines: () => void;
  overview?: OperationsOverviewFixture;
  machines?: readonly FactoryReplayMachine[];
}) {
  const summary = summarizeFactory(machines, overview.monitoredMachines);
  const lastLoad = summary.loadSamples.at(-1);
  const loadChange = (lastLoad ?? 0) - (summary.loadSamples[0] ?? 0);
  const x = (index: number) => {
    const [hours, minutes] = factoryReplaySampleTimes[index]
      .split(":")
      .map(Number);
    return 10 + ((hours + minutes / 60) / 8) * 480;
  };
  const y = (value: number) => 10 + ((100 - value) / 100) * 90;
  return (
    <section
      className="factory-overview"
      aria-labelledby="factory-overview-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="factory-overview-heading">Factory overview</h2>
          <p>
            {overview.monitoredMachines} monitored machines · Recorded demo
            snapshot
          </p>
        </div>
        <button
          type="button"
          className="text-action"
          onClick={onInspectMachines}
        >
          Inspect machines <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="factory-overview-grid">
        <section
          className="factory-summary-block"
          aria-label="Machine status distribution"
        >
          <h3>Machine status</h3>
          <div
            className="factory-state-bar"
            role="img"
            aria-label={`${overview.monitoredMachines} machines: ${summary.states.OPERATING} operating, ${summary.states.RISK} at risk, ${summary.states.FAULTED} faulted, ${summary.states.MAINTENANCE} under maintenance, ${summary.unreported} without reported state`}
          >
            {stateLabels.map(([state, , tone]) => (
              <span
                key={state}
                className={`factory-state-${tone}`}
                style={{
                  width: `${overview.monitoredMachines > 0 ? (summary.states[state] / overview.monitoredMachines) * 100 : 0}%`,
                }}
              />
            ))}
            <span
              className="factory-state-unreported"
              style={{
                width: `${overview.monitoredMachines > 0 ? (summary.unreported / overview.monitoredMachines) * 100 : 0}%`,
              }}
            />
          </div>
          <dl className="factory-status-list">
            {stateLabels.map(([state, label, tone]) => (
              <div key={state}>
                <dt>
                  <span className={`status-dot status-${tone}`} />
                  {label}
                </dt>
                <dd>{summary.states[state]}</dd>
              </div>
            ))}
            <div>
              <dt>
                <span className="status-dot status-unknown" />
                Not reported
              </dt>
              <dd>{summary.unreported}</dd>
            </div>
          </dl>
        </section>
        <section
          className="factory-summary-block factory-load-summary"
          aria-label="Aggregate reported load"
        >
          <div className="factory-load-heading">
            <h3>Mean reported load</h3>
            <span>8h</span>
          </div>
          {lastLoad === undefined ? (
            <p className="factory-load-unavailable">
              No comparable load series available.
            </p>
          ) : (
            <>
              <div className="factory-load-value">
                <strong>{lastLoad.toFixed(1)}%</strong>
                <span>
                  {loadChange > 0 ? "+" : ""}
                  {loadChange.toFixed(1)} pp <span>vs first sample</span>
                </span>
              </div>
              <div className="factory-load-chart">
                <div className="factory-load-y-axis" aria-hidden="true">
                  <span>100%</span>
                  <span>0%</span>
                </div>
                <svg
                  viewBox="0 0 500 110"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`Mean reported load for ${summary.loadSourceCount} of ${overview.monitoredMachines} machines, from ${summary.loadSamples[0].toFixed(1)}% to ${lastLoad.toFixed(1)}% over 8 hours`}
                >
                  <path
                    d="M10 10H490M10 55H490M10 100H490"
                    className="factory-load-guide"
                  />
                  <polygon
                    points={`10,100 ${summary.loadSamples
                      .map((value, index) => `${x(index)},${y(value)}`)
                      .join(" ")} 490,100`}
                    className="factory-load-area"
                  />
                  <polyline
                    points={summary.loadSamples
                      .map((value, index) => `${x(index)},${y(value)}`)
                      .join(" ")}
                    className="factory-load-line"
                  />
                  <circle
                    cx="490"
                    cy={y(lastLoad)}
                    r="3"
                    className="factory-load-point"
                  />
                </svg>
              </div>
              <div className="factory-load-times" aria-hidden="true">
                <span>00:00</span>
                <span>08:00</span>
              </div>
            </>
          )}
          <p className="factory-summary-scope">
            Simple mean · {summary.loadSourceCount}/{overview.monitoredMachines}{" "}
            machines with load history.
            {summary.loadSourceCount < overview.monitoredMachines
              ? " Factory-wide load is not available."
              : ""}
          </p>
        </section>
        <section
          className="factory-summary-block factory-workload"
          aria-label="Factory decision workload"
        >
          <h3>Decision workload</h3>
          <p>{overview.attentionItems.length} cases in the attention queue</p>
          <dl>
            {workLabels.map(([status, label]) => (
              <div key={status}>
                <dt>{label}</dt>
                <dd>
                  {
                    overview.attentionItems.filter(
                      (item) => item.status === status,
                    ).length
                  }
                </dd>
              </div>
            ))}
          </dl>
          <a href="#attention-queue" className="text-action">
            View attention queue <ChevronRight size={16} aria-hidden="true" />
          </a>
          <p className="factory-summary-scope">
            Review and analysis states, separate from machine operating status.
          </p>
        </section>
      </div>
    </section>
  );
}
