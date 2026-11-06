import type { RULDistribution } from "@/types/cnc";
import { cn } from "@/lib/utils";

export type RulDistributionChartProps = {
  distribution: RULDistribution;
  title?: string;
  className?: string;
};

type DistributionBar = {
  key: string;
  support: number | null;
  probability: number;
  survival: boolean;
};

function rawNumber(value: number) {
  return String(value);
}

/**
 * Directly plots probability mass on a fixed 0..1 axis. It deliberately does
 * not aggregate the distribution or derive a point estimate from it.
 */
export function RulDistributionChart({
  distribution,
  title = "RUL distribution",
  className,
}: RulDistributionChartProps) {
  const bars: DistributionBar[] = distribution.support_steps.map(
    (support, index) => ({
      key: `support-${support}-${index}`,
      support,
      probability: distribution.probability_mass[index],
      survival: false,
    }),
  );

  bars.push({
    key: "survival-beyond-horizon",
    support: null,
    probability: distribution.survival_beyond_horizon,
    survival: true,
  });

  const plotWidth = Math.max(380, bars.length * 80 + 48);

  return (
    <figure
      className={cn(
        "min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-5",
        className,
      )}
    >
      <figcaption className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--color-slate-text)]">
            {title}
          </h2>
          <p className="mt-1 text-base text-[var(--color-ash-gray)]">
            Discrete probability mass by simulator step. No point estimate is
            calculated.
          </p>
        </div>
        <div className="shrink-0 text-[13px] text-[var(--color-ash-gray)]">
          <span className="tabular-nums">Model</span>{" "}
          <code className="break-all tabular-nums text-[var(--color-slate-text)]">
            {distribution.model_version}
          </code>
        </div>
      </figcaption>

      <div
        className="mt-5 max-w-full overflow-x-auto pb-2"
        role="region"
        tabIndex={0}
        aria-label="Scrollable RUL probability chart"
      >
        <div style={{ minWidth: plotWidth }} aria-hidden="true">
          <div className="flex">
            <div className="relative h-40 w-12 shrink-0 text-[13px] tabular-nums text-[var(--color-ash-gray)]">
              <span className="absolute right-2 top-0 -translate-y-1/2">1</span>
              <span className="absolute right-2 top-1/4 -translate-y-1/2">
                0.75
              </span>
              <span className="absolute right-2 top-1/2 -translate-y-1/2">
                0.5
              </span>
              <span className="absolute right-2 top-3/4 -translate-y-1/2">
                0.25
              </span>
              <span className="absolute bottom-0 right-2 translate-y-1/2">
                0
              </span>
            </div>

            <div className="relative h-40 flex-1 border-b border-l border-[var(--color-platinum-outline)]">
              {[0, 25, 50, 75, 100].map((percent) => (
                <span
                  key={percent}
                  className={
                    /* taste-skill-ignore: numeric chart guides support reading probability, not decorative rules. */ "pointer-events-none absolute inset-x-0 border-t border-stone-200"
                  }
                  style={{ bottom: `${percent}%` }}
                />
              ))}

              <div className="absolute inset-0 flex items-end gap-3 px-3">
                {bars.map((bar) => (
                  <div
                    key={bar.key}
                    className="relative h-full w-[68px] shrink-0"
                  >
                    <span
                      className={cn(
                        "absolute inset-x-2 bottom-0 rounded-t-sm",
                        bar.probability === 0
                          ? "border-0 bg-transparent"
                          : bar.survival
                            ? "bg-sky-200"
                            : "bg-[var(--color-chartwell-blue)]",
                        bar.probability !== 0 && "border",
                      )}
                      style={{ height: `${bar.probability * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ml-12 flex gap-3 px-3 pt-3">
            {bars.map((bar) => (
              <div
                key={`${bar.key}-label`}
                className="w-[68px] shrink-0 text-center"
              >
                {bar.survival ? (
                  <span className="block break-words tabular-nums text-[13px] leading-4 text-[var(--color-ash-gray)]">
                    Beyond horizon
                  </span>
                ) : (
                  <>
                    <span className="block tabular-nums text-[13px] text-[var(--color-ash-gray)]">
                      Step
                    </span>
                    <code className="block break-all tabular-nums text-[13px] text-[var(--color-slate-text)]">
                      {String(bar.support)}
                    </code>
                  </>
                )}
                <span className="mt-1 block tabular-nums text-[13px] text-[var(--color-ash-gray)]">
                  {bar.survival ? "Survival" : "Probability"}
                </span>
                <code className="block break-all tabular-nums text-[13px] font-semibold text-[var(--color-slate-text)]">
                  {rawNumber(bar.probability)}
                </code>
              </div>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>Exact values returned in the RUL distribution</caption>
        <thead>
          <tr>
            <th scope="col">field</th>
            <th scope="col">support_steps</th>
            <th scope="col">value</th>
          </tr>
        </thead>
        <tbody>
          {distribution.support_steps.map((support, index) => (
            <tr key={`accessible-${support}-${index}`}>
              <th scope="row">probability_mass</th>
              <td>{String(support)}</td>
              <td>{rawNumber(distribution.probability_mass[index])}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">survival_beyond_horizon</th>
            <td>not applicable</td>
            <td>{rawNumber(distribution.survival_beyond_horizon)}</td>
          </tr>
        </tbody>
      </table>
    </figure>
  );
}
