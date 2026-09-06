import { describe, expect, it, vi } from "vitest";

import { HttpProductApiClient } from "@/lib/product-api/client";
import type { CreateExperimentRequest } from "@/types/product-api";

const environmentConfig = {
  schema_version: "2.0" as const,
  environment_id: "cnc-test",
  number_of_machines: 2,
  spare_capacity: 1,
  initial_spares: 1,
  horizon_steps: 2,
  failure_threshold_um: 300,
  seed: 42,
  costs: {
    replacement_cost: 25,
    failure_cost: 500,
    waiting_cost_per_step: 7,
    unused_life_cost_per_step: 1,
  },
  risk: { objective: "EXPECTED_COST" as const, cvar_alpha: 0.95 },
};

const policy = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  policyKey: "fixed-schedule",
  version: "1.0.0",
  name: "Fixed schedule",
  description: null,
};

const experiment = {
  id: "11111111-1111-4111-8111-111111111111",
  experimentKey: "experiment:test",
  name: "HTTP contract test",
  description: null,
  schemaVersion: "2.0",
  status: "READY",
  episodeCount: 1,
  policy,
  environmentConfig,
  createdById: "22222222-2222-4222-8222-222222222222",
  runRequestedAt: null,
  episodesCreated: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const episode = {
  id: "33333333-3333-4333-8333-333333333333",
  episodeKey: "experiment:test:episode:0",
  experimentId: experiment.id,
  episodeIndex: 0,
  policyId: policy.id,
  policy,
  seed: 42,
  attempt: 1,
  status: "COMPLETED",
  stepsCompleted: 1,
  totalCost: 25,
  failureCount: 0,
  replacementCount: 1,
  waitingSteps: 0,
  queuedAt: "2026-09-01T00:00:00.000Z",
  startedAt: "2026-09-01T00:00:01.000Z",
  completedAt: "2026-09-01T00:00:02.000Z",
  failedAt: null,
  cancelledAt: null,
  error: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:02.000Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpProductApiClient", () => {
  it("uses the Product API create, pagination, and run wire contract", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/v1/experiments?")) {
        return json({ success: true, data: [], meta: { page: 2, limit: 8, total: 0, totalPages: 0 } });
      }
      if (url.endsWith("/run")) {
        return json({ success: true, data: { experimentId: experiment.id, status: "RUNNING", episodeCount: 1, episodes: [] } }, 202);
      }
      return json({ success: true, data: experiment }, 201);
    });
    const client = new HttpProductApiClient(fetcher);
    const payload: CreateExperimentRequest = {
      name: "HTTP contract test",
      description: null,
      policyKey: "fixed-schedule",
      policyVersion: "1.0.0",
      episodeCount: 1,
      environmentConfig,
    };

    await client.listExperiments({ page: 2, pageSize: 8 });
    await client.createExperiment(payload);
    await client.runExperiment(experiment.id, "frontend-run:test-key");

    expect(String(fetcher.mock.calls[0][0])).toBe("/api/v1/experiments?page=2&limit=8");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(payload);
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get("Idempotency-Key"))
      .toBe("frontend-run:test-key");
  });

  it("preserves dotted backend validation paths for form fields", async () => {
    const fetcher = vi.fn(async () => json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Experiment request is invalid",
        details: [{
          path: "environmentConfig.initial_spares",
          code: "custom",
          message: "initial_spares cannot exceed spare_capacity",
        }],
      },
    }, 400));

    await expect(new HttpProductApiClient(fetcher).createExperiment({
      name: "Invalid inventory",
      policyKey: "fixed-schedule",
      policyVersion: "1.0.0",
      episodeCount: 1,
      environmentConfig,
    })).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      fieldErrors: {
        "environmentConfig.initial_spares": [
          "initial_spares cannot exceed spare_capacity",
        ],
      },
    });
  });

  it("loads experiment metadata and episodes from separate endpoints", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/episodes?")) {
        return json({ success: true, data: [episode], meta: { page: 1, limit: 100, total: 1, totalPages: 1 } });
      }
      return json({ success: true, data: experiment });
    });
    const detail = await new HttpProductApiClient(fetcher).getExperiment(experiment.id);

    expect(detail.environment_config).toEqual(environmentConfig);
    expect(detail.episodes).toHaveLength(1);
    expect(detail.episodes[0]).toMatchObject({ id: episode.id, attempt: 1, status: "COMPLETED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("assembles a completed episode timeline from canonical event endpoints", async () => {
    const observation = {
      schema_version: "2.0", observation_id: "observation:test", episode_id: episode.id,
      step: 0, machines: [], inventory: { spares_available: 0, capacity: 1 },
    };
    const recommendation = {
      schema_version: "2.0", observation_id: "observation:test", policy_id: "fixed-schedule",
      policy_version: "1.0.0", actions: { schema_version: "2.0", observation_id: "observation:test", actions: [] },
    };
    const result = {
      schema_version: "2.0", observation_id: "observation:test", episode_id: episode.id,
      step: 0, outcomes: [], inventory_after: { spares_available: 0, capacity: 1 },
      total_cost: 25, episode_terminated: true,
    };
    const summary = {
      schema_version: "2.0", episode_id: episode.id, policy_id: "fixed-schedule", seed: 42,
      steps_completed: 1, total_cost: 25, failure_count: 0, replacement_count: 1, waiting_steps: 0,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/v1/episodes/${episode.id}`) return json({ success: true, data: episode });
      if (url === `/api/v1/experiments/${experiment.id}`) return json({ success: true, data: experiment });
      if (url.includes("/observations?")) return json({ success: true, data: [{ step: 0, payload: observation, createdAt: episode.completedAt }], meta: { totalPages: 1 } });
      if (url.includes("/recommendations?")) return json({ success: true, data: [{ step: 0, payload: recommendation, createdAt: episode.completedAt }], meta: { totalPages: 1 } });
      if (url.includes("/results?")) return json({ success: true, data: [{ step: 0, totalCost: 25, payload: result, createdAt: episode.completedAt }], meta: { totalPages: 1 } });
      if (url.includes("/summary?")) return json({ success: true, data: { attempt: 1, payload: summary, createdAt: episode.completedAt } });
      return json({ success: false, error: { message: "Unexpected URL" } }, 404);
    });

    const detail = await new HttpProductApiClient(fetcher).getEpisode(episode.id);
    expect(detail.environment_config).toEqual(environmentConfig);
    expect(detail.summary).toEqual(summary);
    expect(detail.steps).toEqual([
      expect.objectContaining({
        step: 0,
        observation,
        recommendation,
        result,
        step_cost: 25,
      }),
    ]);
  });
});
