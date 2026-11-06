import { describe, expect, it } from "vitest";
import { summarizeFactory } from "@/lib/operations-ui/factory-summary";
import { factoryReplayMachines } from "@/lib/operations-ui/factory-replay";

describe("factory summary scope", () => {
  it("accounts for the full inventory without treating unreported machines as healthy", () => {
    const summary = summarizeFactory(factoryReplayMachines, 12);
    expect(summary.states).toEqual({
      OPERATING: 2,
      RISK: 1,
      FAULTED: 0,
      MAINTENANCE: 0,
    });
    expect(summary.unreported).toBe(9);
    expect(
      Object.values(summary.states).reduce(
        (sum, value) => sum + value,
        summary.unreported,
      ),
    ).toBe(12);
    expect(summary.loadSourceCount).toBe(3);
    expect(summary.loadSamples[0]).toBeCloseTo((62 + 54 + 62) / 3);
    expect(summary.loadSamples[5]).toBeCloseTo((74 + 61 + 89) / 3);
  });

  it("excludes incomplete and invalid load series without replacing missing values with zero", () => {
    const summary = summarizeFactory(
      [
        factoryReplayMachines[0],
        { ...factoryReplayMachines[1], loadSamples: [54] },
        {
          ...factoryReplayMachines[2],
          loadSamples: [62, 66, Number.NaN, 77, 84, 89],
        },
      ],
      12,
    );
    expect(summary.reportedMachines).toBe(3);
    expect(summary.loadSourceCount).toBe(1);
    expect(summary.loadSamples).toEqual(factoryReplayMachines[0].loadSamples);
  });
});
