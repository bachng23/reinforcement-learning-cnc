import type { ReactNode } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExperimentListPage } from "@/components/pages/experiment-list-page";
import { createProductApiStub, deferred } from "@/tests/product-api-test-utils";
import type {
  ExperimentListItem,
  PaginatedResponse,
} from "@/types/product-api";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

function page(items: ExperimentListItem[]): PaginatedResponse<ExperimentListItem> {
  return {
    items,
    page: 1,
    page_size: 8,
    total_items: items.length,
    total_pages: items.length ? 1 : 0,
    has_next: false,
    has_previous: false,
  };
}

describe("ExperimentListPage states", () => {
  it("renders a stable loading state while the request is pending", () => {
    const pendingList = deferred<PaginatedResponse<ExperimentListItem>>();
    const listExperiments = vi.fn(() => pendingList.promise);

    const { unmount } = render(
      <ExperimentListPage api={createProductApiStub({ listExperiments })} />,
    );

    expect(screen.getByLabelText("Loading experiments")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(listExperiments).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("renders an error, retries, and then renders the empty state", async () => {
    const user = userEvent.setup();
    const listExperiments = vi
      .fn()
      .mockRejectedValueOnce(new Error("Product API is unavailable."))
      .mockResolvedValueOnce(page([]));

    render(
      <ExperimentListPage api={createProductApiStub({ listExperiments })} />,
    );

    expect(await screen.findByText("Experiments could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Product API is unavailable.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No experiments yet")).toBeInTheDocument();
    expect(listExperiments).toHaveBeenCalledTimes(2);
  });

  it("renders populated rows without inventing absent optional metadata", async () => {
    const partialExperiment: ExperimentListItem = {
      id: "experiment/partial-result",
      name: "Partially persisted experiment",
      status: "READY",
      policy: {
        id: "policy-threshold-v1",
        name: "Threshold baseline",
        version: "1.0.0",
      },
      created_at: "2026-09-01T08:30:00.000Z",
    };
    const listExperiments = vi.fn(async () => page([partialExperiment]));

    render(
      <ExperimentListPage api={createProductApiStub({ listExperiments })} />,
    );

    expect(await screen.findByText("Partially persisted experiment")).toBeInTheDocument();
    expect(screen.getByText("READY")).toBeInTheDocument();
    expect(screen.getByText("Episode counts unavailable")).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.getByText("Threshold baseline")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Partially persisted experiment" }),
    ).toHaveAttribute("href", "/experiments/experiment%2Fpartial-result");
    await waitFor(() => expect(listExperiments).toHaveBeenCalledTimes(1));
  });
});
