import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentTraceTimeline } from "@/components/operations/agent-trace-timeline";
import { DecisionControls } from "@/components/operations/decision-controls";
import { OperationsOverviewPage } from "@/components/pages/operations-overview-page";
import { RecommendationCenterPage } from "@/components/pages/recommendation-center-page";
import { WhatIfWorkspacePage } from "@/components/pages/what-if-workspace-page";
import { getOperationsFixture } from "@/lib/operations/fixtures";
import type { HumanDecisionRequest } from "@/types/operations";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/operations/recommendations",
}));

describe("operations fixture UI", () => {
  it("renders machine state and authoritative health fields without inventing shift KPIs", () => {
    render(<OperationsOverviewPage />);

    expect(screen.getByRole("heading", { name: "Machine status grid" })).toBeInTheDocument();
    expect(screen.getByText("CNC Mill 01")).toBeInTheDocument();
    expect(screen.getAllByText("31%").length).toBeGreaterThan(0);
    expect(screen.getByText("Expected RUL")).toBeInTheDocument();
    expect(screen.getByText("186 min")).toBeInTheDocument();
    expect(screen.getByText(/Shift KPI cards are intentionally deferred/)).toBeInTheDocument();
  });

  it("renders direct candidate KPIs and changes only the selected fixture plan", async () => {
    const user = userEvent.setup();
    render(<RecommendationCenterPage />);

    expect(screen.getByText("Every KPI below is displayed directly", { exact: false })).toBeInTheDocument();
    const production = screen.getByRole("button", { name: /PRODUCTION PRIORITY/ });
    await user.click(production);
    expect(production).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/M01 retains elevated failure probability before intervention/)).toBeInTheDocument();
  });

  it("builds exact approve, reject and modify HumanDecisionRequest shapes", async () => {
    const fixture = getOperationsFixture();
    const candidate = fixture.recommendation.candidate_plans[0];
    const requests: HumanDecisionRequest[] = [];
    const user = userEvent.setup();
    const view = render(<DecisionControls
      decisionCaseId="case-health-M01-0921"
      recommendationId="recommendation-M01-001"
      snapshotId="snapshot-shift-a-0921"
      selectedCandidate={candidate}
      modifiedSchedule={fixture.modified_schedule}
      onDecision={(request) => { requests.push(request); }}
    />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Preview request" }));
    expect(requests[0]).toEqual(expect.objectContaining({
      decision: "APPROVE",
      candidate_plan_id: candidate.candidate_plan_id,
      expected_plan_version: candidate.plan_version,
      expected_snapshot_id: "snapshot-shift-a-0921",
    }));

    view.rerender(<DecisionControls decisionCaseId="case-health-M01-0921" recommendationId="recommendation-M01-001" snapshotId="snapshot-shift-a-0921" selectedCandidate={candidate} modifiedSchedule={fixture.modified_schedule} onDecision={(request) => { requests.push(request); }} />);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Preview request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("rejection note is required");
    await user.type(screen.getByRole("textbox", { name: /Decision note/ }), "Keep the current plan for this shift.");
    await user.click(screen.getByRole("button", { name: "Preview request" }));
    expect(requests.at(-1)).toEqual(expect.objectContaining({ decision: "REJECT", note: "Keep the current plan for this shift." }));

    view.rerender(<DecisionControls decisionCaseId="case-health-M01-0921" recommendationId="recommendation-M01-001" snapshotId="snapshot-shift-a-0921" selectedCandidate={candidate} modifiedSchedule={fixture.modified_schedule} onDecision={(request) => { requests.push(request); }} />);
    await user.click(screen.getByRole("button", { name: "Modify" }));
    await user.click(screen.getByRole("button", { name: "Preview request" }));
    expect(requests.at(-1)).toEqual(expect.objectContaining({ decision: "MODIFY", modified_schedule: fixture.modified_schedule }));
  });

  it("switches sanitized tool details without exposing a computed latency", async () => {
    const fixture = getOperationsFixture();
    const user = userEvent.setup();
    render(<AgentTraceTimeline runs={fixture.agent_runs} toolCalls={fixture.tool_calls} messages={fixture.messages} />);

    await user.click(screen.getByRole("button", { name: /run-cp-sat/ }));
    expect(screen.getByRole("complementary", { name: "Tool call detail" })).toHaveTextContent("run-cp-sat@0.8.0");
    expect(screen.getByText("Not supplied by v3")).toBeInTheDocument();
    expect(screen.getByText("Structured agent messages")).toBeInTheDocument();
  });

  it("renders simulator-returned what-if KPIs without committing a schedule", async () => {
    const user = userEvent.setup();
    render(<WhatIfWorkspacePage />);

    expect(screen.getByRole("heading", { name: "No simulation result" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Technician unavailable/ }));
    await user.click(screen.getByRole("button", { name: "Run fixture" }));

    expect(screen.getByRole("heading", { name: "Baseline vs simulated plan" })).toBeInTheDocument();
    expect(screen.getByText(/simulation-technician-001/)).toBeInTheDocument();
    expect(screen.getByText("RELIABILITY_PRIORITY")).toBeInTheDocument();
    expect(screen.getByText(/cannot create a committed schedule/i)).toBeInTheDocument();
    expect(screen.getByText("candidate.validated")).toBeInTheDocument();
  });
});
