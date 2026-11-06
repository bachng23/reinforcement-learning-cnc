"use client";

import {
  Bot,
  CheckCircle2,
  CircleDot,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { DataNotice } from "@/components/research/data-notice";
import { PageHeader } from "@/components/research/page-header";
import { agentControlRoomFixture } from "@/lib/operations-ui/fixtures";
import type {
  AgentControlRoomFixture,
  AgentRole,
  AgentRunSummary,
  DecisionEventItem,
  RunStatus,
} from "@/types/operations-ui";

const ROLE_LABELS: Record<AgentRole, string> = {
  SUPERVISOR: "Orchestration",
  PDM: "Predictive maintenance",
  PRODUCTION_SCHEDULING: "Production impact",
  MAINTENANCE_PLANNING: "Maintenance planning",
  TECHNICIAN_DISPATCH: "Resource matching",
  INTEGRATED_PLANNING: "Integrated planning",
  VALIDATION: "Constraint validation",
  EXPLANATION: "Explanation",
  RAQMIX_POLICY: "Machine policy",
};
const STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  WAITING_FOR_DEPENDENCY: "Waiting",
  COMPLETED: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  NOT_CONFIGURED: "Not configured",
};
function eventIcon(event: DecisionEventItem) {
  return event.eventType.startsWith("tool.")
    ? Wrench
    : event.eventType === "candidate.validated"
      ? ShieldCheck
      : event.eventType.startsWith("agent.")
        ? Bot
        : CircleDot;
}
function formatTime(value?: string) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
      }).format(new Date(value))
    : "—";
}

function AgentNode({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentRunSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Inspect ${agent.displayName}`}
      aria-pressed={selected}
      className={`agent-node ${selected ? "is-selected" : ""}`}
    >
      <span className="agent-node-top">
        <Bot size={19} aria-hidden="true" />
        <span
          className={`agent-status agent-status-${agent.status.toLowerCase()}`}
        >
          {STATUS_LABELS[agent.status]}
        </span>
      </span>
      <strong>{agent.displayName}</strong>
      <span className="agent-role">{ROLE_LABELS[agent.role]}</span>
      <span className="agent-output">
        {agent.outputLabel ?? "No output yet"}
      </span>
      <span className="agent-tool-count">{agent.toolCallCount} tool calls</span>
    </button>
  );
}

function AgentInspector({ agent }: { agent: AgentRunSummary }) {
  return (
    <aside className="dss-panel agent-inspector" aria-label="Agent details">
      <div className="section-heading">
        <div>
          <h2>{agent.displayName}</h2>
          <p>{ROLE_LABELS[agent.role]}</p>
        </div>
      </div>
      <div className="agent-inspector-content">
        <p>{agent.goal ?? "Waiting for an upstream dependency."}</p>
        <dl className="inspector-facts">
          <div>
            <dt>Status</dt>
            <dd>{STATUS_LABELS[agent.status]}</dd>
          </div>
          <div>
            <dt>Run ID</dt>
            <dd>{agent.agentRunId}</dd>
          </div>
          <div>
            <dt>Tools called</dt>
            <dd>{agent.toolCallCount}</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>{agent.authority ?? "Read-only evidence access"}</dd>
          </div>
        </dl>
        <h3>Allowed tools</h3>
        {agent.allowedTools?.length ? (
          <ul className="allowed-tools">
            {agent.allowedTools.map((tool) => (
              <li key={tool}>
                <Wrench size={15} aria-hidden="true" />
                <code>{tool}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tool-empty">
            <LockKeyhole size={15} aria-hidden="true" />
            No direct tool access
          </p>
        )}
        {agent.outputLabel && (
          <div className="agent-result">
            <h3>Latest output</h3>
            <p>{agent.outputLabel}</p>
          </div>
        )}
        {agent.status === "NOT_CONFIGURED" && (
          <div className="data-notice notice-warning">
            <TriangleAlert size={17} aria-hidden="true" />
            <p>Checkpoint and CTDE adapter are not configured yet.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

export function AgentControlRoomPage({
  fixture = agentControlRoomFixture,
}: {
  fixture?: AgentControlRoomFixture;
}) {
  const orderedEvents = useMemo(
    () => [...fixture.events].sort((a, b) => a.sequence - b.sequence),
    [fixture.events],
  );
  const [selectedAgentId, setSelectedAgentId] = useState(
    fixture.agents.find((agent) => agent.role === "PDM")?.agentRunId ??
      fixture.agents[0]?.agentRunId,
  );
  const [selectedEventId, setSelectedEventId] = useState(
    orderedEvents.at(-1)?.eventId ?? "",
  );
  const selectedAgent =
    fixture.agents.find((agent) => agent.agentRunId === selectedAgentId) ??
    fixture.agents[0];
  const selectedEvent =
    orderedEvents.find((event) => event.eventId === selectedEventId) ??
    orderedEvents.at(-1);
  const gathering = fixture.agents.filter((agent) =>
    [
      "PDM",
      "TECHNICIAN_DISPATCH",
      "PRODUCTION_SCHEDULING",
      "MAINTENANCE_PLANNING",
      "INTEGRATED_PLANNING",
    ].includes(agent.role),
  );
  const downstream = fixture.agents.filter(
    (agent) => !gathering.includes(agent),
  );

  return (
    <AppShell title="Agent Control Room">
      <main className="dss-page">
        <PageHeader
          title="Agent Control Room"
          description="Follow the evidence from specialist tools to policy inference and validation."
        />
        <DataNotice demo />
        <div className="agent-case-summary">
          <div>
            <span>Decision case</span>
            <strong>{fixture.decisionCaseId}</strong>
          </div>
          <div>
            <span>Trigger</span>
            <strong>{fixture.trigger}</strong>
          </div>
          <div>
            <span>Stage</span>
            <strong>{fixture.status.replaceAll("_", " ")}</strong>
          </div>
          <div>
            <span>Recorded events</span>
            <strong>{orderedEvents.length}</strong>
          </div>
        </div>
        <div className="agent-workspace">
          <section
            className="dss-panel agent-flow"
            aria-labelledby="flow-title"
          >
            <div className="section-heading">
              <div>
                <h2 id="flow-title">Decision flow</h2>
                <p>Select a component to inspect its tools and authority.</p>
              </div>
            </div>
            <div className="agent-flow-body">
              <h3>Evidence gathering</h3>
              <div className="agent-gathering">
                {gathering.map((agent) => (
                  <AgentNode
                    key={agent.agentRunId}
                    agent={agent}
                    selected={selectedAgentId === agent.agentRunId}
                    onSelect={() => setSelectedAgentId(agent.agentRunId)}
                  />
                ))}
              </div>
              <p className="flow-explanation">
                <CheckCircle2 size={16} aria-hidden="true" />
                Evidence is collected before policy inference and constraint
                validation.
              </p>
              <h3>Policy & review pipeline</h3>
              <div className="agent-downstream">
                {downstream.map((agent) => (
                  <AgentNode
                    key={agent.agentRunId}
                    agent={agent}
                    selected={selectedAgentId === agent.agentRunId}
                    onSelect={() => setSelectedAgentId(agent.agentRunId)}
                  />
                ))}
              </div>
            </div>
          </section>
          {selectedAgent && <AgentInspector agent={selectedAgent} />}
        </div>
        <section className="dss-panel" aria-labelledby="events-title">
          <div className="section-heading">
            <div>
              <h2 id="events-title">Authoritative event stream</h2>
              <p>
                Sanitized, recorded events for this decision case. Times shown
                in UTC.
              </p>
            </div>
            <span className="subtle-status">{orderedEvents.length} events</span>
          </div>
          <div className="event-workspace">
            <ol className="event-list">
              {orderedEvents.map((event) => {
                const Icon = eventIcon(event);
                return (
                  <li key={event.eventId}>
                    <button
                      type="button"
                      aria-label={event.title}
                      aria-pressed={selectedEventId === event.eventId}
                      onClick={() => setSelectedEventId(event.eventId)}
                      className={`event-row ${selectedEventId === event.eventId ? "is-selected" : ""}`}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>
                        <strong>{event.title}</strong>
                        <span>{event.summary}</span>
                      </span>
                      <time dateTime={event.occurredAt}>
                        {formatTime(event.occurredAt)}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ol>
            <aside className="event-detail" aria-label="Selected event detail">
              {selectedEvent ? (
                <>
                  <span className="subtle-status">
                    Event {selectedEvent.sequence}
                  </span>
                  <h3>{selectedEvent.title}</h3>
                  <p>{selectedEvent.summary}</p>
                  <dl className="inspector-facts">
                    <div>
                      <dt>Event type</dt>
                      <dd>{selectedEvent.eventType}</dd>
                    </div>
                    <div>
                      <dt>Subject</dt>
                      <dd>{selectedEvent.subjectId}</dd>
                    </div>
                    <div>
                      <dt>Evidence</dt>
                      <dd>{selectedEvent.evidenceRefs.join(", ") || "None"}</dd>
                    </div>
                  </dl>
                  <details open>
                    <summary>Structured output</summary>
                    <pre>{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
                  </details>
                </>
              ) : (
                <p>Select an event to inspect its output.</p>
              )}
            </aside>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
