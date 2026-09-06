import type { ReactNode } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExperimentDetailPage } from "@/components/pages/experiment-detail-page";
import { MOCK_ENVIRONMENT_CONFIG, MOCK_POLICY_CATALOG } from "@/lib/product-api/fixtures";
import { createProductApiStub } from "@/tests/product-api-test-utils";
import type { ExperimentDetail } from "@/types/product-api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ experimentId: "experiment-ready" }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const readyExperiment: ExperimentDetail = {
  id: "experiment-ready",
  key: "experiment:ready",
  name: "Ready experiment",
  status: "READY",
  policy: {
    id: MOCK_POLICY_CATALOG[0].id,
    key: MOCK_POLICY_CATALOG[0].key,
    name: MOCK_POLICY_CATALOG[0].name,
    version: MOCK_POLICY_CATALOG[0].version,
  },
  environment_config: MOCK_ENVIRONMENT_CONFIG,
  number_of_episodes: 2,
  episode_counts: { total: 0, pending: 0 },
  episodes: [],
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

describe("ExperimentDetailPage run action", () => {
  it("reuses the idempotency key when a run request is retried", async () => {
    const user = userEvent.setup();
    const getExperiment = vi.fn(async () => readyExperiment);
    const runExperiment = vi.fn()
      .mockRejectedValueOnce(new Error("Temporary network failure"))
      .mockResolvedValueOnce(undefined);
    const api = createProductApiStub({ getExperiment, runExperiment });

    render(<ExperimentDetailPage api={api} pollIntervalMs={60_000} />);
    const runButton = await screen.findByRole("button", { name: "Run experiment" });

    await user.click(runButton);
    expect(await screen.findByText("Temporary network failure")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run experiment" }));

    await waitFor(() => expect(runExperiment).toHaveBeenCalledTimes(2));
    expect(runExperiment.mock.calls[0][0]).toBe("experiment-ready");
    expect(runExperiment.mock.calls[0][1]).toMatch(/^frontend-run:/);
    expect(runExperiment.mock.calls[1][1]).toBe(runExperiment.mock.calls[0][1]);
    await waitFor(() => expect(getExperiment).toHaveBeenCalledTimes(2));
  });
});
