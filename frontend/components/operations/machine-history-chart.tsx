import {
  factoryReplaySampleTimes,
  type FactoryReplayMachine,
} from "@/lib/operations-ui/factory-replay";

const sampleHours = factoryReplaySampleTimes.map((time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours + minutes / 60;
});
const x = (index: number) => 10 + (sampleHours[index] / 8) * 880;
const y = (value: number) => 16 + ((100 - value) / 100) * 224;

export function MachineHistoryChart({
  machine,
  sample,
  onSample,
}: {
  machine: FactoryReplayMachine;
  sample: number;
  onSample: (index: number) => void;
}) {
  const points = (values: readonly number[]) =>
    values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const change = machine.healthSamples[sample] - machine.healthSamples[0];
  return (
    <section
      className={`machine-history ${machine.status === "RISK" || machine.status === "FAULTED" ? "history-at-risk" : ""}`}
      aria-labelledby={`history-${machine.id}`}
    >
      <div className="machine-history-heading">
        <div>
          <h4 id={`history-${machine.id}`}>Health & load history</h4>
          <p>Recorded demo samples · 8h · Select a point to inspect</p>
        </div>
        <div className="machine-history-legend">
          <span>
            <i />
            Health
          </span>
          <span>
            <i />
            Load
          </span>
        </div>
      </div>
      <div className="machine-history-readout" aria-live="polite">
        <span>
          Sample <strong>{factoryReplaySampleTimes[sample]}</strong>
        </span>
        <span>
          Health <strong>{machine.healthSamples[sample]}%</strong>
        </span>
        <span>
          Load <strong>{machine.loadSamples[sample]}%</strong>
        </span>
        <span>
          Health change{" "}
          <strong>
            {change > 0 ? "+" : ""}
            {change} pp
          </strong>
          <span>vs first sample</span>
        </span>
      </div>
      <div className="machine-history-plot">
        <div className="machine-history-y-axis" aria-hidden="true">
          {[100, 75, 50, 25, 0].map((value) => (
            <span key={value}>{value}%</span>
          ))}
        </div>
        <svg
          viewBox="0 0 900 256"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Demo health and load samples for ${machine.id}`}
        >
          {[100, 75, 50, 25, 0].map((value) => (
            <line
              key={value}
              x1="10"
              x2="890"
              y1={y(value)}
              y2={y(value)}
              className="history-gridline"
            />
          ))}
          <line
            x1={x(sample)}
            x2={x(sample)}
            y1="16"
            y2="240"
            className="history-selection"
          />
          <polyline
            points={points(machine.healthSamples)}
            className="history-health-line"
          />
          <polyline
            points={points(machine.loadSamples)}
            className="history-load-line"
          />
          {machine.healthSamples.map((value, index) => (
            <circle
              key={`health-${index}`}
              cx={x(index)}
              cy={y(value)}
              r={sample === index ? 5 : 3}
              className="history-health-point"
            />
          ))}
          {machine.loadSamples.map((value, index) => (
            <circle
              key={`load-${index}`}
              cx={x(index)}
              cy={y(value)}
              r={sample === index ? 5 : 3}
              className="history-load-point"
            />
          ))}
          {factoryReplaySampleTimes.map((time, index) => (
            <rect
              key={time}
              x={Math.max(0, x(index) - 35)}
              y="0"
              width="70"
              height="256"
              fill="transparent"
              aria-hidden="true"
              onClick={() => onSample(index)}
              className="history-sample-target"
            />
          ))}
        </svg>
      </div>
      <div
        className="machine-history-times"
        aria-label="Inspect demo trend sample"
      >
        {factoryReplaySampleTimes.map((time, index) => (
          <button
            key={time}
            type="button"
            aria-pressed={sample === index}
            onClick={() => onSample(index)}
            style={{ left: `${(sampleHours[index] / 8) * 100}%` }}
            className={
              index === 0
                ? "sample-first"
                : index === sampleHours.length - 1
                  ? "sample-last"
                  : undefined
            }
          >
            {time}
          </button>
        ))}
      </div>
      <p className="machine-history-note">
        Health and load are percentages on a shared 0–100% scale. Recorded
        samples do not predict future values.
      </p>
    </section>
  );
}
