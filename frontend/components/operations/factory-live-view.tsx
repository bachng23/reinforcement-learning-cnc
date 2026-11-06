"use client";

import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { operationsOverviewFixture } from "@/lib/operations-ui/fixtures";
import {
  factoryReplayMachines,
  factoryReplaySampleTimes,
  factoryReplayStages,
  type FactoryReplayMachine,
  type FactoryMachineStatus,
} from "@/lib/operations-ui/factory-replay";
import {
  MachinePicker,
  type MachinePickerItem,
} from "@/components/operations/machine-picker";
import { MachineHistoryChart } from "@/components/operations/machine-history-chart";

const statusLabels: Record<FactoryMachineStatus | "UNKNOWN", string> = {
  OPERATING: "Operating",
  RISK: "Needs attention",
  FAULTED: "Faulted",
  MAINTENANCE: "Under maintenance",
  UNKNOWN: "Status not reported",
};

export function FactoryLiveView({
  machineId,
  onSelect,
  machines = factoryReplayMachines,
}: {
  machineId?: string;
  onSelect?: (id: string) => void;
  machines?: readonly FactoryReplayMachine[];
} = {}) {
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [internalMachine, setSelectedMachine] = useState<string>("M03");
  const selectedMachine = machineId ?? internalMachine;
  const [sample, setSample] = useState(5);
  const detail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSample(5);
  }, [selectedMachine]);
  const stage = factoryReplayStages[step];
  const maintenanceStarted = step === 2;
  const activeMachine = machines.find(
    (machine) => machine.id === selectedMachine,
  );
  const statusFor = (machine: FactoryReplayMachine): FactoryMachineStatus =>
    machine.id === "M03" && maintenanceStarted ? "MAINTENANCE" : machine.status;
  const activeStatus = activeMachine ? statusFor(activeMachine) : "UNKNOWN";
  const attention = operationsOverviewFixture.attentionItems.find(
    (item) => item.machineId === selectedMachine,
  );
  const choices: MachinePickerItem[] = [
    ...machines.map((machine) => ({
      id: machine.id,
      name: machine.name,
      status: statusFor(machine),
    })),
    ...operationsOverviewFixture.attentionItems
      .filter(
        (item) => !machines.some((machine) => machine.id === item.machineId),
      )
      .map(
        (item): MachinePickerItem => ({
          id: item.machineId,
          name: item.title,
          status: "UNKNOWN",
        }),
      ),
  ];
  const hasSamples =
    activeMachine &&
    activeMachine.healthSamples.length === factoryReplaySampleTimes.length &&
    activeMachine.loadSamples.length === factoryReplaySampleTimes.length;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setStep((current) =>
        Math.min(current + 1, factoryReplayStages.length - 1),
      );
      if (step >= factoryReplayStages.length - 2) setPlaying(false);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  const selectMachine = (id: string) => {
    setSelectedMachine(id);
    onSelect?.(id);
    setSample(5);
    requestAnimationFrame(() => detail.current?.focus({ preventScroll: true }));
  };

  return (
    <section
      className="factory-workspace"
      aria-labelledby="factory-live-heading"
    >
      <div className="factory-toolbar">
        <div>
          <h2 id="factory-live-heading">Machine evidence</h2>
          <p>Select a machine to inspect its recorded state and history.</p>
        </div>
        <MachinePicker
          items={choices}
          selectedId={selectedMachine}
          onSelect={selectMachine}
        />
      </div>
      <div
        ref={detail}
        className="machine-inspector machine-detail"
        aria-label="Selected machine details"
        tabIndex={-1}
      >
        <header className="machine-detail-heading">
          <h3>
            {selectedMachine} ·{" "}
            {activeMachine?.name ??
              attention?.title ??
              "Machine record unavailable"}
          </h3>
          <span className={`machine-state state-${activeStatus.toLowerCase()}`}>
            <span
              className={`status-dot status-${activeStatus.toLowerCase()}`}
            />
            {statusLabels[activeStatus]}
          </span>
        </header>
        <div className="machine-evidence-layout">
          <aside
            className="machine-context"
            aria-label="Current machine context"
          >
            <div
              className={`machine-recommendation ${activeStatus === "RISK" || activeStatus === "FAULTED" ? "recommendation-urgent" : ""}`}
            >
              <strong>
                {attention?.title ??
                  (activeStatus === "OPERATING"
                    ? "Stable production"
                    : "Recorded machine status")}
              </strong>
              <p>
                {attention?.action ??
                  (activeStatus === "OPERATING"
                    ? "Continue monitoring the machine."
                    : "Inspect available evidence before choosing an action.")}
              </p>
              {attention && <span>{attention.impact}</span>}
            </div>
            <h4>Latest recorded state</h4>
            <dl className="machine-signals">
              <div>
                <dt>Failure risk</dt>
                <dd>{attention?.risk ?? "Not reported"}</dd>
              </div>
              <div>
                <dt>Demo health</dt>
                <dd className={activeMachine ? "numeric" : undefined}>
                  {activeMachine ? `${activeMachine.health}%` : "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Current load</dt>
                <dd className={activeMachine ? "numeric" : undefined}>
                  {activeMachine ? `${activeMachine.load}%` : "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Technician in replay</dt>
                <dd>
                  {selectedMachine === "M03" && step > 0
                    ? `T02 · ${maintenanceStarted ? "In service" : "Dispatched"}`
                    : "None assigned"}
                </dd>
              </div>
            </dl>
            {attention && (
              <p className="machine-evidence">
                Evidence <span>{attention.evidence}</span>
              </p>
            )}
            <Link href="/decisions" className="inspector-action">
              Open review queue <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </aside>
          {hasSamples && activeMachine ? (
            <MachineHistoryChart
              machine={activeMachine}
              sample={sample}
              onSample={setSample}
            />
          ) : (
            <div className="machine-history-unavailable">
              <h4>History unavailable</h4>
              <p>
                No health or load samples are available for this machine in the
                recorded dataset.
              </p>
              <p>The case evidence remains available on the left.</p>
            </div>
          )}
        </div>
      </div>
      <details
        className="maintenance-replay"
        onToggle={(event) => {
          if (!event.currentTarget.open) setPlaying(false);
        }}
      >
        <summary>
          <Wrench size={16} aria-hidden="true" />
          <strong>Maintenance replay</strong>
          <span>M03 · Demo only</span>
        </summary>
        <div className="maintenance-replay-content">
          <div className="replay-event" aria-live="polite">
            <span className="event-time">{stage.time}</span>
            <div>
              <strong>{stage.title}</strong>
              <p>{stage.description}</p>
            </div>
            <span>
              {step + 1} / {factoryReplayStages.length}
            </span>
          </div>
          <div className="replay-controls">
            <button
              type="button"
              className="control-button"
              aria-label={playing ? "Pause simulation" : "Play simulation"}
              onClick={() => {
                if (step === 2) setStep(0);
                setPlaying((current) => !current);
              }}
            >
              {playing ? (
                <Pause size={16} aria-hidden="true" />
              ) : (
                <Play size={16} aria-hidden="true" />
              )}
              {playing ? "Pause" : step === 2 ? "Replay" : "Play"}
            </button>
            <button
              type="button"
              className="control-button icon-control"
              aria-label="Advance simulation"
              title="Advance simulation"
              disabled={step === 2}
              onClick={() => {
                setPlaying(false);
                setStep((current) => Math.min(current + 1, 2));
              }}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="control-button icon-control"
              aria-label="Reset simulation"
              title="Reset simulation"
              onClick={() => {
                setStep(0);
                setPlaying(false);
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
