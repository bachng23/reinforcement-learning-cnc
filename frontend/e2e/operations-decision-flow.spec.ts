import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

const apiBase = required("OPERATIONS_E2E_API_URL").replace(/\/+$/, "");
const aiBase = required("OPERATIONS_E2E_AI_URL").replace(/\/+$/, "");
const factoryId = process.env.OPERATIONS_E2E_FACTORY_ID || "factory-demo-01";
const adminPassword = required("OPERATIONS_E2E_ADMIN_PASSWORD");
const evidenceFile = required("OPERATIONS_E2E_EVIDENCE_FILE");

type JsonObject = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function json(response: APIResponse): Promise<JsonObject> {
  return await response.json() as JsonObject;
}

function record(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object response");
  }
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected an array response");
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Expected ${label}`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected ${label}`);
  return value;
}

function envelopeValue(payload: JsonObject): unknown {
  expect(payload.success).toBe(true);
  return payload.data;
}

function envelopeData(payload: JsonObject): JsonObject {
  return record(envelopeValue(payload));
}

function planningConfig(overrides: JsonObject = {}): JsonObject {
  return {
    horizon_minutes: 720,
    candidate_limit: 3,
    solver_timeout_seconds: 30,
    simulation_runs: 100,
    base_seed: 20260922,
    allowed_strategy_ids: ["production-priority", "balanced", "reliability-priority"],
    ...overrides,
  };
}

function liveRequest(mode: "LIVE" | "SIMULATION_ONLY", overrides: JsonObject = {}): JsonObject {
  const simulation = mode === "SIMULATION_ONLY";
  return {
    mode,
    trigger: simulation
      ? { type: "WHAT_IF", scenario_id: `browser-e2e-${randomUUID()}`, assumptions: {} }
      : { type: "MANUAL_REPLAN", reason: "Browser E2E planning request" },
    planning_config: planningConfig(),
    ...overrides,
  };
}

async function createCase(
  request: APIRequestContext,
  context: { snapshotId: string; planVersion: number },
  caseRequest: JsonObject,
  key = `e2e-${randomUUID()}`,
) {
  const response = await request.post(`${apiBase}/api/v1/decision-cases`, {
    headers: { "Idempotency-Key": key, "X-Request-Id": key },
    data: {
      schema_version: "3.0",
      factory_id: factoryId,
      expected_snapshot_id: context.snapshotId,
      expected_plan_version: context.planVersion,
      request: caseRequest,
    },
  });
  return { response, key };
}

async function currentContext(request: APIRequestContext) {
  const response = await request.get(`${apiBase}/api/v1/operations/snapshot`, {
    params: { factory_id: factoryId },
  });
  expect(response.status()).toBe(200);
  const data = envelopeData(await json(response));
  return {
    snapshotId: string(data.snapshot_id, "snapshot_id"),
    planVersion: number(data.plan_version, "plan_version"),
  };
}

async function currentSchedule(request: APIRequestContext): Promise<JsonObject> {
  const response = await request.get(`${apiBase}/api/v1/schedules/current`, {
    params: { factory_id: factoryId },
  });
  expect(response.status()).toBe(200);
  return envelopeData(await json(response));
}

async function waitForCase(
  request: APIRequestContext,
  caseId: string,
  accepted: readonly string[],
): Promise<JsonObject> {
  let latest: JsonObject | undefined;
  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/api/v1/decision-cases/${encodeURIComponent(caseId)}`);
    if (response.status() !== 200) return false;
    latest = envelopeData(await json(response));
    return accepted.includes(String(latest.status));
  }, { timeout: 90_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  return latest!;
}

function recommendationFingerprint(recommendation: JsonObject): string {
  const candidates = array(recommendation.candidate_plans).map(candidateValue => {
    const candidate = record(candidateValue);
    const schedule = record(candidate.schedule);
    const kpis = record(candidate.kpis);
    return {
      strategy: candidate.strategy,
      plan_version: candidate.plan_version,
      kpis: Object.fromEntries([
        "makespan_minutes",
        "total_tardiness_minutes",
        "maximum_tardiness_minutes",
        "on_time_completion_rate",
        "maintenance_cost",
        "technician_utilization",
        "schedule_changes",
      ].map(key => [key, kpis[key]])),
      assignments: array(schedule.assignments).map(assignmentValue => {
        const assignment = record(assignmentValue);
        return {
          assignment_type: assignment.assignment_type,
          machine_id: assignment.machine_id,
          job_id: assignment.job_id,
          operation_id: assignment.operation_id,
          maintenance_request_id: assignment.maintenance_request_id,
          technician_ids: assignment.technician_ids,
          start_at: assignment.start_at,
          end_at: assignment.end_at,
          status: assignment.status,
          locked: assignment.locked,
        };
      }),
      validation_verdict: record(candidate.validation).verdict,
    };
  }).sort((left, right) => String(left.strategy).localeCompare(String(right.strategy)));
  return createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
}

test("real snapshot flows through browser, worker and FastAPI with safe negative boundaries", async ({ page, browser }) => {
  test.slow();

  const anonymous = await browser.newContext();
  const anonymousResponse = await anonymous.request.get(`${apiBase}/api/v1/operations/snapshot`, {
    params: { factory_id: factoryId },
  });
  expect(anonymousResponse.status()).toBe(401);
  await anonymous.close();

  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/operations");
  await expect(page.getByRole("main").getByRole("heading", { name: "Operations Overview" })).toBeVisible();
  await expect(page.getByText("CNC M06").first()).toBeVisible();
  await expect(page.getByRole("note").first()).toContainText("Live Operations API mode");
  const contextBefore = await currentContext(page.request);
  const scheduleBefore = await currentSchedule(page.request);

  await page.getByTestId("create-live-decision-case").click();
  await expect(page).toHaveURL(/\/operations\/recommendations\?caseId=/);
  const caseId = new URL(page.url()).searchParams.get("caseId");
  expect(caseId).toBeTruthy();
  await expect(page.getByText("AWAITING_APPROVAL", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Candidate comparison" })).toBeVisible();

  const recommendationResponse = await page.request.get(
    `${apiBase}/api/v1/decision-cases/${encodeURIComponent(caseId!)}/recommendation`,
  );
  expect(recommendationResponse.status()).toBe(200);
  const recommendationArtifact = envelopeData(await json(recommendationResponse));
  const recommendation = record(recommendationArtifact.recommendation);
  const snapshot = record(recommendationArtifact.snapshot);
  const candidates = array(recommendation.candidate_plans).map(record);
  expect(candidates.length).toBeGreaterThanOrEqual(1);
  expect(candidates.length).toBeLessThanOrEqual(3);
  expect(recommendation.decision_case_id).toBe(caseId);
  expect(recommendation.snapshot_id).toBe(contextBefore.snapshotId);
  expect(snapshot.factory_id).toBe(factoryId);
  for (const candidate of candidates) {
    expect(candidate.decision_case_id).toBe(caseId);
    expect(candidate.snapshot_id).toBe(contextBefore.snapshotId);
    expect(record(candidate.validation).verdict).toBe("VALID");
  }

  const eventsResponse = await page.request.get(
    `${apiBase}/api/v1/decision-cases/${encodeURIComponent(caseId!)}/events`,
  );
  expect(eventsResponse.status()).toBe(200);
  const events = array(envelopeValue(await json(eventsResponse)));
  expect(events.map(value => record(value).sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(record(events[0]).type).toBe("CASE_CREATED");
  expect(record(record(events[0]).actor).id).toBeTruthy();

  const persistedCase = await waitForCase(page.request, caseId!, ["AWAITING_APPROVAL"]);
  const actorId = string(record(record(events[0]).actor).id, "case actor id");
  const replayRequest = {
    schema_version: "3.0",
    decision_case_id: caseId,
    mode: "LIVE",
    factory_snapshot: snapshot,
    trigger: {
      type: "MANUAL_REPLAN",
      event_id: caseId,
      occurred_at: persistedCase.created_at,
      requested_by_user_id: actorId,
      reason: "Operations Overview manual planning request",
    },
    planning_config: planningConfig(),
    requested_by_user_id: actorId,
  };
  const replayHeaders = { "X-Request-Id": `replay-${caseId}`, "X-Correlation-Id": caseId! };
  const replayOneResponse = await page.request.post(`${aiBase}/v1/operations/plan`, {
    headers: replayHeaders,
    data: replayRequest,
  });
  const replayTwoResponse = await page.request.post(`${aiBase}/v1/operations/plan`, {
    headers: replayHeaders,
    data: replayRequest,
  });
  expect(replayOneResponse.status()).toBe(200);
  expect(replayTwoResponse.status()).toBe(200);
  const replayOne = await json(replayOneResponse);
  const replayTwo = await json(replayTwoResponse);
  expect(replayTwo).toEqual(replayOne);
  expect(replayOne).toEqual(recommendation);

  await page.reload();
  await expect(page.getByText("AWAITING_APPROVAL", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Candidate comparison" })).toBeVisible();

  const stale = await createCase(page.request, {
    ...contextBefore,
    planVersion: contextBefore.planVersion + 1,
  }, liveRequest("LIVE"));
  expect(stale.response.status()).toBe(409);
  expect(record((await json(stale.response)).error).code).toBe("PLAN_VERSION_CONFLICT");

  const replayKey = `lost-response-${randomUUID()}`;
  const replayBody = liveRequest("SIMULATION_ONLY");
  const first = await createCase(page.request, contextBefore, replayBody, replayKey);
  expect(first.response.status()).toBe(202);
  await first.response.dispose(); // Deliberately discard the first response before replaying the command.
  const replay = await createCase(page.request, contextBefore, replayBody, replayKey);
  expect(replay.response.status()).toBe(202);
  expect(replay.response.headers()["idempotency-replayed"]).toBe("true");
  const replayCase = envelopeData(await json(replay.response));
  const replayAgain = await createCase(page.request, contextBefore, replayBody, replayKey);
  expect(envelopeData(await json(replayAgain.response)).decision_case_id).toBe(replayCase.decision_case_id);

  const simulationCaseId = string(replayCase.decision_case_id, "simulation case id");
  const simulationCommit = await page.request.post(
    `${apiBase}/api/v1/decision-cases/${encodeURIComponent(simulationCaseId)}/decision`,
    {
      headers: { "Idempotency-Key": `sim-commit-${randomUUID()}` },
      data: {
        command: "COMMIT",
        expected_snapshot_id: contextBefore.snapshotId,
        expected_plan_version: contextBefore.planVersion,
        expected_case_revision: 1,
        candidate_revision: 1,
      },
    },
  );
  expect(simulationCommit.status()).toBeGreaterThanOrEqual(400);
  expect(simulationCommit.status()).toBeLessThan(500);

  const failure = await createCase(page.request, contextBefore, liveRequest("LIVE", {
    planning_config: {
      horizon_minutes: 720,
      candidate_limit: 3,
      solver_timeout_seconds: 30,
      simulation_runs: 1,
      base_seed: 20260922,
      allowed_strategy_ids: ["unsupported-e2e-strategy"],
    },
  }));
  expect(failure.response.status()).toBe(202);
  const failureCaseId = string(envelopeData(await json(failure.response)).decision_case_id, "failure case id");
  const failedCase = await waitForCase(page.request, failureCaseId, ["FAILED"]);
  expect(["PLANNING_FAILED", "PLANNER_UNAVAILABLE"]).toContain(failedCase.error_code);

  const scheduleAfter = await currentSchedule(page.request);
  expect(scheduleAfter.snapshot_id).toBe(scheduleBefore.snapshot_id);
  expect(scheduleAfter.plan_version).toBe(scheduleBefore.plan_version);
  expect(scheduleAfter.schedule).toEqual(scheduleBefore.schedule);

  const evidence = {
    schema_version: "1.0",
    run: process.env.OPERATIONS_E2E_RUN || "1",
    git_sha: process.env.OPERATIONS_E2E_GIT_SHA || "unknown",
    completed_at: new Date().toISOString(),
    factory_id: factoryId,
    snapshot_id: contextBefore.snapshotId,
    base_plan_version: contextBefore.planVersion,
    decision_case_id: caseId,
    recommendation_id: recommendation.recommendation_id,
    candidate_count: candidates.length,
    recommendation_fingerprint: recommendationFingerprint(recommendation),
    event_sequences: events.map(value => record(value).sequence),
    checks: {
      real_fastapi_recommendation: "passed",
      exact_same_request_replay: "passed",
      unauthorized_access: "passed",
      stale_case_creation: "passed",
      lost_create_response_receipt_replay: "passed",
      simulation_commit_rejected: simulationCommit.status() === 404 ? "blocked_by_missing_decision_endpoint" : "passed",
      planner_failure_preserved_schedule: "passed",
      reload_preserved_recommendation: "passed",
      decision_write_http_status: simulationCommit.status(),
      full_approval_commit_flow: simulationCommit.status() === 404 ? "not_available_on_base" : "requires_backend_frontend_write_capability",
      stale_decision_command: simulationCommit.status() === 404 ? "not_available_on_base" : "not_executed",
      competing_commits: simulationCommit.status() === 404 ? "not_available_on_base" : "not_executed",
      decision_command_receipt_replay: simulationCommit.status() === 404 ? "not_available_on_base" : "not_executed",
    },
  };
  await mkdir(path.dirname(evidenceFile), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await test.info().attach("operations-e2e-evidence", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
});
