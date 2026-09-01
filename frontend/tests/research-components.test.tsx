import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AsyncState } from "@/components/research/async-state";
import { RulDistributionChart } from "@/components/research/rul-distribution-chart";
import { StatusBadge } from "@/components/research/status-badge";

describe("research presentation components", () => {
  it("renders loading, error, and empty states and exposes retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(
      <AsyncState
        kind="error"
        title="Experiment request failed"
        description="The Product API returned an error."
        onRetry={retry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Experiment request failed");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    rerender(<AsyncState kind="loading" title="Loading episodes" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading episodes")).toBeInTheDocument();

    rerender(<AsyncState kind="empty" title="No episodes" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("No episodes")).toBeInTheDocument();
  });

  it("keeps unknown status text exactly as supplied", () => {
    render(<StatusBadge status="PAUSED_BY_WORKER" />);

    expect(screen.getByText("PAUSED_BY_WORKER")).toBeInTheDocument();
    expect(screen.queryByText("Paused By Worker")).not.toBeInTheDocument();
  });

  it("renders exact RUL support, mass, and beyond-horizon values", () => {
    render(
      <RulDistributionChart
        distribution={{
          support_steps: [0, 7],
          probability_mass: [0.123456, 0.5],
          survival_beyond_horizon: 0.376544,
          model_version: "m4-contract-test",
        }}
      />,
    );

    const exactValues = screen.getByRole("table", {
      name: "Exact values returned in the RUL distribution",
    });
    expect(within(exactValues).getByText("0.123456")).toBeInTheDocument();
    expect(within(exactValues).getByText("0.5")).toBeInTheDocument();
    expect(within(exactValues).getByText("0.376544")).toBeInTheDocument();
    expect(within(exactValues).getByText("7")).toBeInTheDocument();
    expect(within(exactValues).getByText("survival_beyond_horizon")).toBeInTheDocument();
    expect(screen.getByText("m4-contract-test")).toBeInTheDocument();
    expect(screen.queryByText(/expected RUL|mean RUL/i)).not.toBeInTheDocument();
  });
});
