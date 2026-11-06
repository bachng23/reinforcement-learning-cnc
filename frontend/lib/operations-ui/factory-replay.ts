/** UI-only replay data. These samples do not represent backend telemetry or policy output. */
export type FactoryMachineStatus =
  | "OPERATING"
  | "RISK"
  | "FAULTED"
  | "MAINTENANCE";
export type FactoryReplayMachine = {
  id: string;
  name: string;
  status: FactoryMachineStatus;
  load: number;
  health: number;
  healthSamples: readonly number[];
  loadSamples: readonly number[];
};

export const factoryReplayMachines = [
  {
    id: "M01",
    name: "Milling cell",
    status: "OPERATING",
    load: 74,
    health: 94,
    healthSamples: [96, 95, 96, 95, 94, 94],
    loadSamples: [62, 66, 64, 69, 72, 74],
  },
  {
    id: "M02",
    name: "Turning cell",
    status: "OPERATING",
    load: 61,
    health: 94,
    healthSamples: [95, 95, 94, 95, 94, 94],
    loadSamples: [54, 57, 55, 60, 58, 61],
  },
  {
    id: "M03",
    name: "Spindle cell",
    status: "RISK",
    load: 89,
    health: 62,
    healthSamples: [88, 85, 81, 74, 67, 62],
    loadSamples: [62, 66, 70, 77, 84, 89],
  },
] as const satisfies readonly FactoryReplayMachine[];

export const factoryReplayStages = [
  {
    time: "08:17",
    title: "Risk detected",
    description:
      "M03 is flagged for review. T02 is available in the technician bay.",
    technician: "Available",
  },
  {
    time: "08:18",
    title: "Technician dispatched",
    description:
      "The demo sends T02 to M03. This is a replay, not an approved assignment.",
    technician: "Moving to M03",
  },
  {
    time: "08:19",
    title: "Service started",
    description:
      "T02 is servicing M03. Health remains unchanged until completion is recorded.",
    technician: "Servicing M03",
  },
] as const;

export const factoryReplaySampleTimes = [
  "00:00",
  "01:30",
  "03:00",
  "04:30",
  "06:00",
  "08:00",
] as const;
