import {
  factoryReplaySampleTimes,
  type FactoryReplayMachine,
} from "@/lib/operations-ui/factory-replay";

/** Aggregate only recorded readings. Missing fleet members never inherit sample status or load. */
export function summarizeFactory(
  machines: readonly FactoryReplayMachine[],
  monitoredMachines: number,
) {
  const states = { OPERATING: 0, RISK: 0, FAULTED: 0, MAINTENANCE: 0 };
  for (const machine of machines) states[machine.status] += 1;
  const unreported = Math.max(0, monitoredMachines - machines.length);
  const loadSources = machines.filter(
    (machine) =>
      machine.loadSamples.length === factoryReplaySampleTimes.length &&
      machine.loadSamples.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 100,
      ),
  );
  const loadSamples =
    loadSources.length === 0
      ? []
      : factoryReplaySampleTimes.map(
          (_, index) =>
            loadSources.reduce(
              (sum, machine) => sum + machine.loadSamples[index],
              0,
            ) / loadSources.length,
        );
  return {
    states,
    unreported,
    reportedMachines: machines.length,
    loadSourceCount: loadSources.length,
    loadSamples,
  };
}
