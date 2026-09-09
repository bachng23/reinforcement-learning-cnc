import type { ReactNode } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EpisodeDetailPage } from "@/components/pages/episode-detail-page";
import { AuthRedirectError } from "@/lib/auth";
import { ProductApiError } from "@/lib/product-api/errors";
import { MOCK_ENVIRONMENT_CONFIG, MOCK_POLICY_CATALOG } from "@/lib/product-api/fixtures";
import { createProductApiStub, deferred } from "@/tests/product-api-test-utils";
import type { EpisodeDetail, EpisodeStatus } from "@/types/product-api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ episodeId: "episode-week2" }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function episode(status: EpisodeStatus, attempt = 1): EpisodeDetail {
  const policy = MOCK_POLICY_CATALOG[0];
  return {
    id: "episode-week2",
    key: "episode:week2",
    experiment_id: "experiment-week2",
    status,
    attempt,
    seed: 42,
    policy: {
      id: policy.id,
      key: policy.key,
      name: policy.name,
      version: policy.version,
    },
    environment_config: MOCK_ENVIRONMENT_CONFIG,
    steps_completed: status === "COMPLETED" ? 1 : 0,
    total_cost: status === "COMPLETED" ? 25 : null,
    created_at: "2026-09-07T00:00:00.000Z",
    updated_at: "2026-09-07T00:01:00.000Z",
    started_at: status === "PENDING" ? null : "2026-09-07T00:00:10.000Z",
    completed_at: status === "COMPLETED" ? "2026-09-07T00:01:00.000Z" : null,
    failure: status === "FAILED"
      ? { code: "ENGINE_FAILED", message: "Engine failed safely." }
      : null,
    summary: null,
    steps: [],
  };
}

describe("EpisodeDetailPage actions and attempts", () => {
  it("retries a FAILED episode once and loads the incremented attempt", async () => {
    const user = userEvent.setup();
    const request = deferred<{ id: string; status: "PENDING"; attempt: number }>();
    const getEpisode = vi.fn()
      .mockResolvedValueOnce(episode("FAILED", 1))
      .mockResolvedValueOnce(episode("PENDING", 2));
    const retryEpisode = vi.fn(() => request.promise);
    const api = createProductApiStub({ getEpisode, retryEpisode });

    render(<EpisodeDetailPage api={api} pollIntervalMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: "Retry episode" }));

    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
    request.resolve({ id: "episode-week2", status: "PENDING", attempt: 2 });

    expect(await screen.findByText("Attempt 2 of 2.")).toBeInTheDocument();
    expect(retryEpisode).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getEpisode).toHaveBeenCalledTimes(2));
  });

  it("cancels a PENDING episode once and renders the terminal state", async () => {
    const user = userEvent.setup();
    const request = deferred<{ id: string; status: "CANCELLED"; attempt: number }>();
    const getEpisode = vi.fn()
      .mockResolvedValueOnce(episode("PENDING", 1))
      .mockResolvedValueOnce(episode("CANCELLED", 1));
    const cancelEpisode = vi.fn(() => request.promise);
    const api = createProductApiStub({ getEpisode, cancelEpisode });

    render(<EpisodeDetailPage api={api} pollIntervalMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: "Cancel episode" }));

    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    request.resolve({ id: "episode-week2", status: "CANCELLED", attempt: 1 });

    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
    expect(cancelEpisode).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Cancel episode" })).not.toBeInTheDocument();
  });

  it("switches to persisted output from an older attempt", async () => {
    const user = userEvent.setup();
    const current = {
      ...episode("COMPLETED", 2),
      summary: {
        schema_version: "2.0" as const,
        episode_id: "episode:week2",
        policy_id: "fixed-schedule",
        seed: 42,
        steps_completed: 1,
        total_cost: 222,
        failure_count: 0,
        replacement_count: 1,
        waiting_steps: 0,
      },
    };
    const historical = {
      ...current,
      summary: { ...current.summary, total_cost: 111 },
    };
    const getEpisode = vi.fn(async (_id: string, options?: { attempt?: number }) => (
      options?.attempt === 1 ? historical : current
    ));
    const api = createProductApiStub({ getEpisode });

    render(<EpisodeDetailPage api={api} pollIntervalMs={60_000} />);
    expect(await screen.findByText("Attempt 2 of 2.")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "View attempt" }), "1");

    expect(await screen.findByText("Attempt 1 of 2.")).toBeInTheDocument();
    expect(screen.getByText("111")).toBeInTheDocument();
    expect(getEpisode).toHaveBeenLastCalledWith(
      "episode-week2",
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it("reconciles current state after a retry conflict", async () => {
    const user = userEvent.setup();
    const getEpisode = vi.fn()
      .mockResolvedValueOnce(episode("FAILED", 1))
      .mockResolvedValueOnce(episode("PENDING", 2));
    const retryEpisode = vi.fn(async () => {
      throw new ProductApiError("Episode is PENDING; expected FAILED.", {
        status: 409,
        code: "INVALID_EPISODE_TRANSITION",
      });
    });
    const api = createProductApiStub({ getEpisode, retryEpisode });

    render(<EpisodeDetailPage api={api} pollIntervalMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: "Retry episode" }));

    expect(await screen.findByText(/Conflict: Episode is PENDING/)).toBeInTheDocument();
    expect(await screen.findByText("Attempt 2 of 2.")).toBeInTheDocument();
    expect(retryEpisode).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "network",
      new ProductApiError("Unable to reach the Product API.", {
        status: 0,
        code: "NETWORK_ERROR",
      }),
      /Network error: Unable to reach/,
    ],
    ["authentication", new AuthRedirectError(), /session has expired/i],
  ])("renders %s request errors", async (_label, error, expected) => {
    const api = createProductApiStub({
      getEpisode: vi.fn(async () => { throw error; }),
    });

    render(<EpisodeDetailPage api={api} pollIntervalMs={60_000} />);

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });
});
