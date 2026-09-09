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

  it("runs once, polls to completion, and exposes the episode detail route", async () => {
    const user = userEvent.setup();
    const pendingEpisode = {
      id: "episode-completes",
      experiment_id: readyExperiment.id,
      status: "PENDING" as const,
      attempt: 1,
      seed: 42,
      policy: readyExperiment.policy,
      steps_completed: 0,
      total_cost: null,
    };
    const runningExperiment: ExperimentDetail = {
      ...readyExperiment,
      status: "RUNNING",
      episode_counts: { total: 1, pending: 1, running: 0, completed: 0 },
      episodes: [pendingEpisode],
    };
    const completedExperiment: ExperimentDetail = {
      ...runningExperiment,
      status: "COMPLETED",
      episode_counts: { total: 1, pending: 0, running: 0, completed: 1 },
      episodes: [{
        ...pendingEpisode,
        status: "COMPLETED",
        steps_completed: 4,
        total_cost: 25,
      }],
    };
    const getExperiment = vi.fn()
      .mockResolvedValueOnce(readyExperiment)
      .mockResolvedValueOnce(runningExperiment)
      .mockResolvedValue(completedExperiment);
    const runExperiment = vi.fn(async () => undefined);
    const api = createProductApiStub({ getExperiment, runExperiment });

    const view = render(<ExperimentDetailPage api={api} pollIntervalMs={10} />);
    await user.click(await screen.findByRole("button", { name: "Run experiment" }));

    await waitFor(() => expect(getExperiment).toHaveBeenCalledTimes(3));
    expect(runExperiment).toHaveBeenCalledTimes(1);
    const episodeLink = await screen.findByRole("link", {
      name: "Open episode episode-completes",
    });
    expect(episodeLink).toHaveAttribute("href", "/episodes/episode-completes");
    expect(screen.getByText("All listed episodes are terminal. Automatic polling is stopped."))
      .toBeInTheDocument();

    view.unmount();
    render(<ExperimentDetailPage api={api} pollIntervalMs={10} />);
    await screen.findByRole("link", { name: "Open episode episode-completes" });
    expect(runExperiment).toHaveBeenCalledTimes(1);
  });
});
