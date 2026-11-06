import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

import { AgentControlRoomPage } from "@/components/pages/agent-control-room-page";
import { DashboardPage } from "@/components/pages/dashboard-page";
import { FactoryLiveView } from "@/components/operations/factory-live-view";
import { WhatIfWorkspacePage } from "@/components/pages/what-if-workspace-page";
import { factoryReplayMachines } from "@/lib/operations-ui/factory-replay";
import { FactoryOverview } from "@/components/operations/factory-overview";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// jsdom does not implement scrolling; browser QA verifies actual drill-down positioning.
const originalScroll = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  Element.prototype.scrollIntoView = originalScroll;
});

describe("operations UI ports", () => {
  it("groups machine choices by reported status and supports search, Escape and selection", async () => {
    const user = userEvent.setup();
    render(<FactoryLiveView />);
    const trigger = screen.getByRole("button", { name: "Select machine" });
    expect(
      screen.queryByRole("dialog", { name: "Machine directory" }),
    ).not.toBeInTheDocument();
    await user.click(trigger);
    expect(
      screen.getByRole("searchbox", { name: "Search machines" }),
    ).toHaveFocus();
    expect(
      within(screen.getByRole("region", { name: "At risk" })).getByRole(
        "button",
        { name: "Inspect M03 Spindle cell" },
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Operating normally" }),
      ).getAllByRole("button"),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole("region", { name: "Faulted" })).getByText(
        "No recorded machines",
      ),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("searchbox", { name: "Search machines" }),
      "does-not-exist",
    );
    expect(
      screen.getByText("No machines match this search."),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.type(
      screen.getByRole("searchbox", { name: "Search machines" }),
      "m02",
    );
    await user.click(
      screen.getByRole("button", { name: "Inspect M02 Turning cell" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Selected machine details")).getByRole(
        "heading",
        { name: "M02 · Turning cell" },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Demo health and load samples for M02" }),
    ).toBeInTheDocument();
  });

  it("shows a faulted machine only when its source reports that status", async () => {
    const user = userEvent.setup();
    render(
      <FactoryLiveView
        machines={[
          ...factoryReplayMachines,
          {
            ...factoryReplayMachines[2],
            id: "M04",
            name: "Grinding cell",
            status: "FAULTED",
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select machine" }));
    await user.click(
      within(screen.getByRole("region", { name: "Faulted" })).getByRole(
        "button",
        { name: "Inspect M04 Grinding cell" },
      ),
    );
    expect(
      within(screen.getByLabelText("Selected machine details")).getByText(
        "Faulted",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Demo health and load samples for M04" }),
    ).toBeInTheDocument();
  });

  it("filters and sorts the attention queue, then opens the matching source evidence", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    const queue = screen.getByRole("table");
    await user.click(screen.getByRole("button", { name: "Machine / case" }));
    expect(within(queue).getAllByRole("row")[1]).toHaveTextContent("M02");
    await user.type(
      screen.getByRole("searchbox", { name: "Search attention queue" }),
      "M07",
    );
    expect(within(queue).getAllByRole("row")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Inspect evidence for M07" }),
    );
    const details = screen.getByLabelText("Selected machine details");
    expect(details).toHaveTextContent("M07");
    expect(details).toHaveTextContent(
      "No health or load samples are available",
    );
    expect(details).not.toHaveTextContent("71% failure probability");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Status" }),
      "NEEDS_REVIEW",
    );
    expect(within(queue).getAllByRole("row")).toHaveLength(2);
    expect(within(queue).getByText("M03")).toBeInTheDocument();
  });

  it("shows factory-level aggregates above the separate machine evidence", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    const factory = screen.getByRole("region", { name: "Factory overview" });
    expect(
      within(factory).getByRole("img", {
        name: /12 machines: 2 operating, 1 at risk, 0 faulted, 0 under maintenance, 9 without reported state/,
      }),
    ).toBeInTheDocument();
    expect(within(factory).getByText("74.7%")).toBeInTheDocument();
    expect(
      within(factory).getByRole("img", {
        name: /Mean reported load for 3 of 12 machines/,
      }),
    ).toBeInTheDocument();
    expect(within(factory).queryByText("M03")).not.toBeInTheDocument();
    expect(within(factory).queryByText("M01")).not.toBeInTheDocument();
    await user.click(
      within(factory).getByRole("button", { name: "Inspect machines" }),
    );
    expect(
      within(screen.getByLabelText("Selected machine details")).getByRole(
        "heading",
        { name: "M03 · Spindle cell" },
      ),
    ).toBeInTheDocument();
  });

  it("does not draw a factory load chart without source series", () => {
    render(<FactoryOverview machines={[]} onInspectMachines={vi.fn()} />);
    expect(
      screen.getByText("No comparable load series available."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Mean reported load/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /12 without reported state/ }),
    ).toBeInTheDocument();
  });

  it("opens with an operational attention queue and links to review workflows", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("heading", { name: "Operations overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Attention queue" }),
    ).toBeInTheDocument();
    const queue = screen.getByRole("table");
    expect(within(queue).getByText("M03")).toBeInTheDocument();
    expect(
      within(queue).getByTitle("71% failure probability"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Recorded sample data, not live telemetry/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open full queue/i }),
    ).toHaveAttribute("href", "/decisions");
  });

  it("updates machine evidence and exact demo samples when selecting a cell", async () => {
    const user = userEvent.setup();
    render(<FactoryLiveView />);
    const details = screen.getByLabelText("Selected machine details");
    expect(within(details).getByText("risk-M03-t120")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "00:00" }));
    expect(within(details).getByText("88%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select machine" }));
    await user.click(
      screen.getByRole("button", { name: "Inspect M01 Milling cell" }),
    );
    expect(
      within(details).getByRole("heading", { name: "M01 · Milling cell" }),
    ).toBeInTheDocument();
    expect(within(details).getByText("Not reported")).toBeInTheDocument();
    expect(
      within(details).queryByText("risk-M03-t120"),
    ).not.toBeInTheDocument();
    expect(
      within(details).getByRole("link", { name: "Open review queue" }),
    ).toHaveAttribute("href", "/decisions");
  });

  it("steps and resets demo dispatch without claiming maintenance completed or changing health", async () => {
    const user = userEvent.setup();
    render(<FactoryLiveView />);
    await user.click(screen.getByText("Maintenance replay"));
    expect(
      screen.getByRole("button", { name: "Play simulation" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Advance simulation" }),
    );
    expect(screen.getByText("Technician dispatched")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Advance simulation" }),
    );
    expect(screen.getByText("Service started")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advance simulation" }),
    ).toBeDisabled();
    expect(
      within(screen.getByLabelText("Selected machine details")).getAllByText(
        "62%",
      ),
    ).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Reset simulation" }));
    expect(screen.getByText("Risk detected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advance simulation" }),
    ).toBeEnabled();
    expect(screen.getByText("None assigned")).toBeInTheDocument();
  });

  it("pauses autoplay and stops at the last replay state", () => {
    vi.useFakeTimers();
    try {
      const view = render(<FactoryLiveView />);
      fireEvent.click(screen.getByText("Maintenance replay"));
      fireEvent.click(screen.getByRole("button", { name: "Play simulation" }));
      act(() => {
        vi.advanceTimersByTime(2800);
      });
      expect(screen.getByText("Technician dispatched")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Pause simulation" }));
      act(() => {
        vi.advanceTimersByTime(5600);
      });
      expect(screen.getByText("Technician dispatched")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Play simulation" }));
      act(() => {
        vi.advanceTimersByTime(2800);
      });
      expect(screen.getByText("Service started")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Play simulation" }),
      ).toHaveTextContent("Replay");
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders v3 agent runs and inspects an authoritative event", async () => {
    const user = userEvent.setup();
    render(<AgentControlRoomPage />);

    expect(
      screen.getByRole("heading", { name: "Agent Control Room" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("PdM Agent")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Inspect Resource Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect Production Impact Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect RA-QMIX Policy" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Inspect Resource Agent" }),
    );
    expect(
      within(screen.getByLabelText("Agent details")).getByText(
        "check_technician_eligibility",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect Deterministic Validator" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Checkpoint and CTDE adapter not present"),
    ).toBeInTheDocument();
    expect(screen.getByText("13 events")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Risk tool completed/ }),
    );

    expect(screen.getByLabelText("Selected event detail")).toHaveTextContent(
      "tool.completed",
    );
    expect(screen.getByLabelText("Selected event detail")).toHaveTextContent(
      "health-M03-001",
    );
    expect(screen.getByLabelText("Selected event detail")).toHaveTextContent(
      "failure_probability",
    );
  });

  it("shows simulator-owned results only after running a scenario", async () => {
    const user = userEvent.setup();
    render(<WhatIfWorkspacePage />);

    expect(
      screen.getByRole("heading", { name: "No simulation result" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Technician unavailable/ }),
    );
    await user.click(screen.getByRole("button", { name: "Run scenario" }));

    expect(
      screen.getByRole("heading", { name: "Baseline vs simulated plan" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sim-run-tech-001/)).toBeInTheDocument();
    expect(screen.getByText("RELIABILITY PRIORITY")).toBeInTheDocument();
    expect(
      screen.getByText("T04 reaches 78% utilization."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot create a committed schedule/i),
    ).toBeInTheDocument();
  });
});
