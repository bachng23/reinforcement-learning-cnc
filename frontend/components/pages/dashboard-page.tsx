"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  ChevronRight,
  FlaskConical,
  Info,
  Search,
  ArrowDownUp,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { FactoryLiveView } from "@/components/operations/factory-live-view";
import { FactoryOverview } from "@/components/operations/factory-overview";
import { AppShell } from "@/components/app-shell";
import { operationsOverviewFixture } from "@/lib/operations-ui/fixtures";
import type { AttentionItem } from "@/types/operations-ui";

const statusLabels: Record<AttentionItem["status"], string> = {
  NEEDS_REVIEW: "Needs review",
  ANALYZING: "AI analyzing",
  MONITORING: "Monitoring",
};
const severityLabels: Record<AttentionItem["severity"], string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export function DashboardPage() {
  const overview = operationsOverviewFixture;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState<"priority" | "machine">("priority");
  const [ascending, setAscending] = useState(true);
  const [machine, setMachine] = useState("M03");
  const evidenceRef = useRef<HTMLDivElement>(null);
  const openMachineEvidence = () => {
    requestAnimationFrame(() => {
      const inspector =
        evidenceRef.current?.querySelector<HTMLElement>(".machine-inspector");
      inspector?.focus({ preventScroll: true });
      evidenceRef.current?.scrollIntoView({ block: "start" });
    });
  };
  const inspect = (id: string) => {
    setMachine(id);
    openMachineEvidence();
  };
  const cases = useMemo(() => {
    const priority = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return overview.attentionItems
      .filter(
        (item) =>
          (status === "ALL" || item.status === status) &&
          `${item.machineId} ${item.title} ${item.action}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      )
      .sort(
        (a, b) =>
          (ascending ? 1 : -1) *
          (sort === "machine"
            ? a.machineId.localeCompare(b.machineId)
            : priority[a.severity] - priority[b.severity]),
      );
  }, [overview.attentionItems, search, status, sort, ascending]);
  const changeSort = (key: "priority" | "machine") => {
    setSort(key);
    setAscending(sort === key ? !ascending : true);
  };
  const needsReview = overview.attentionItems.filter(
    (item) => item.status === "NEEDS_REVIEW",
  ).length;
  const snapshotLabel = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(overview.snapshotAt));

  return (
    <AppShell title="Operations overview">
      <main className="dss-page">
        <header className="overview-heading">
          <div>
            <h1>Operations overview</h1>
            <p>Machine health, maintenance priorities and the next decision.</p>
          </div>
          <div className="overview-actions">
            <Link href="/operations" className="secondary-action">
              Factory resources
            </Link>
            <Link href="/decisions" className="primary-action">
              Review recommendations <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <div className="snapshot-notice">
          <Info size={16} aria-hidden="true" />
          <p>
            <strong>Demo workspace.</strong> Recorded sample data, not live
            telemetry.
          </p>
          <span>{overview.factoryId}</span>
        </div>

        <dl className="overview-metrics" aria-label="Factory snapshot">
          <div className="metric-review">
            <dt>Awaiting review</dt>
            <dd>
              {needsReview}
              <span>case needs a decision</span>
            </dd>
          </div>
          <div>
            <dt>Monitored machines</dt>
            <dd>
              {overview.monitoredMachines}
              <span>in the factory snapshot</span>
            </dd>
          </div>
          <div className="metric-analysis">
            <dt>Active AI runs</dt>
            <dd>
              {overview.activeAgentRuns}
              <span>gathering evidence</span>
            </dd>
          </div>
          <div>
            <dt>Maintenance windows</dt>
            <dd>
              {overview.upcomingWindows}
              <span>upcoming in the snapshot</span>
            </dd>
          </div>
        </dl>

        <FactoryOverview onInspectMachines={openMachineEvidence} />
        <div className="priority-brief">
          <span className="priority-marker" aria-hidden="true" />
          <div>
            <strong>M03 needs a maintenance review</strong>
            <p>
              {overview.attentionItems[0].risk}.{" "}
              {overview.attentionItems[0].impact}.
            </p>
          </div>
          <button
            type="button"
            className="text-action"
            onClick={() => inspect("M03")}
          >
            Inspect evidence <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        <section
          id="attention-queue"
          className="attention-section"
          aria-labelledby="attention-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="attention-heading">Attention queue</h2>
              <p>
                {overview.attentionItems.length} cases to review, analyze or
                monitor
              </p>
            </div>
            <Link href="/decisions" className="text-action">
              Open full queue <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="table-toolbar">
            <label className="table-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search attention queue</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search machine or case"
              />
            </label>
            <label className="table-filter">
              Status{" "}
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="ALL">All statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {(search || status !== "ALL") && (
              <button
                type="button"
                className="text-action"
                onClick={() => {
                  setSearch("");
                  setStatus("ALL");
                }}
              >
                Clear filters
              </button>
            )}
            <span role="status">
              {cases.length} of {overview.attentionItems.length} cases
            </span>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Attention queue data"
          >
            <table className="attention-table">
              <thead>
                <tr>
                  <th
                    scope="col"
                    aria-sort={
                      sort === "machine"
                        ? ascending
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="table-sort"
                      onClick={() => changeSort("machine")}
                    >
                      Machine / case{" "}
                      <ArrowDownUp size={13} aria-hidden="true" />
                    </button>
                  </th>
                  <th
                    scope="col"
                    className="status-cell"
                    aria-sort={
                      sort === "priority"
                        ? ascending
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="table-sort"
                      onClick={() => changeSort("priority")}
                    >
                      Priority & status{" "}
                      <ArrowDownUp size={13} aria-hidden="true" />
                    </button>
                  </th>
                  <th scope="col" className="numeric-cell">
                    Reported risk
                  </th>
                  <th scope="col">Impact</th>
                  <th scope="col">Recommended next step</th>
                  <th scope="col">
                    <span className="sr-only">Review</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      <span className="queue-machine">{item.machineId}</span>
                      <span className="queue-case">{item.title}</span>
                    </th>
                    <td className="status-cell">
                      <span
                        className={`severity severity-${item.severity.toLowerCase()}`}
                      >
                        {severityLabels[item.severity]}
                      </span>
                      <span className="cell-secondary">
                        {statusLabels[item.status]}
                      </span>
                    </td>
                    <td
                      className={
                        /^\d/.test(item.risk) ? "numeric-cell" : undefined
                      }
                      title={item.risk}
                    >
                      {/^\d+% /.test(item.risk) ? (
                        <>
                          <span className="numeric">
                            {item.risk.split(" ")[0]}
                          </span>
                          <span className="cell-secondary">
                            {item.risk.split(" ").slice(1).join(" ")}
                          </span>
                        </>
                      ) : (
                        item.risk
                      )}
                    </td>
                    <td>{item.impact}</td>
                    <td>{item.action}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => inspect(item.machineId)}
                        className="queue-open"
                        aria-label={`Inspect evidence for ${item.machineId}`}
                      >
                        <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      No cases match these filters. Clear the search or choose
                      another status.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div ref={evidenceRef} className="overview-evidence-anchor">
          <FactoryLiveView machineId={machine} onSelect={setMachine} />
        </div>

        <section
          className="workspace-resources"
          aria-label="Evidence and planning tools"
        >
          <div>
            <h2>Evidence & planning</h2>
            <p>Understand the recommendation before making a decision.</p>
          </div>
          <Link href="/agents">
            <Bot size={22} aria-hidden="true" />
            <span>
              <strong>Inspect agent activity</strong>
              <span>Tool results, evidence and validation events</span>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/what-if">
            <FlaskConical size={22} aria-hidden="true" />
            <span>
              <strong>Compare a scenario</strong>
              <span>Test assumptions in an isolated simulation</span>
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
        <footer className="overview-footer">
          <span>Snapshot recorded {snapshotLabel} UTC</span>
          <span>Human review required before operational approval</span>
        </footer>
      </main>
    </AppShell>
  );
}
