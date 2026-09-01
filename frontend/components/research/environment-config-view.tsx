import type { EnvironmentConfig } from "@/types/cnc";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type EnvironmentConfigViewProps = {
  config: EnvironmentConfig;
  title?: string;
  className?: string;
};

type ConfigValueProps = {
  name: string;
  value: string | number | boolean | undefined;
};

function ConfigValue({ name, value }: ConfigValueProps) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--color-stone-border)] bg-white px-3 py-2.5">
      <dt className="break-all font-mono text-[11px] font-medium text-[var(--color-ash-gray)]">{name}</dt>
      <dd className="mt-1 break-all font-mono text-sm tabular-nums text-[var(--color-slate-text)]">
        {value === undefined ? (
          <span className="font-sans text-[var(--color-ash-gray)]">Not provided</span>
        ) : (
          String(value)
        )}
      </dd>
    </div>
  );
}

function ConfigSection({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] p-3 sm:p-4">
      <h3 className="mb-3 break-all font-mono text-xs font-semibold text-[var(--color-slate-text)]">{name}</h3>
      <dl className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">{children}</dl>
    </section>
  );
}

/** Renders every CNC contract v2 EnvironmentConfig field using wire-format names. */
export function EnvironmentConfigView({
  config,
  title = "Environment configuration",
  className,
}: EnvironmentConfigViewProps) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-5", className)}>
      <h2 className="text-sm font-semibold text-[var(--color-slate-text)]">{title}</h2>

      <div className="mt-4 space-y-3">
        <ConfigSection name="environment">
          <ConfigValue name="schema_version" value={config.schema_version} />
          <ConfigValue name="environment_id" value={config.environment_id} />
          <ConfigValue name="number_of_machines" value={config.number_of_machines} />
          <ConfigValue name="seed" value={config.seed} />
          <ConfigValue name="spare_capacity" value={config.spare_capacity} />
          <ConfigValue name="initial_spares" value={config.initial_spares} />
          <ConfigValue name="horizon_steps" value={config.horizon_steps} />
          <ConfigValue name="failure_threshold_um" value={config.failure_threshold_um} />
        </ConfigSection>

        <ConfigSection name="costs">
          <ConfigValue name="replacement_cost" value={config.costs.replacement_cost} />
          <ConfigValue name="failure_cost" value={config.costs.failure_cost} />
          <ConfigValue name="waiting_cost_per_step" value={config.costs.waiting_cost_per_step} />
          <ConfigValue name="unused_life_cost_per_step" value={config.costs.unused_life_cost_per_step} />
        </ConfigSection>

        <ConfigSection name="risk">
          <ConfigValue name="objective" value={config.risk.objective} />
          <ConfigValue name="cvar_alpha" value={config.risk.cvar_alpha} />
        </ConfigSection>
      </div>
    </section>
  );
}
