import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { expect, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createOperationsApiClient } from "../lib/operations-api/client";
import { caseStatuses, processingStatuses, zeroBuckets } from "../lib/operations-api/overview";

const apiBase = required("OPERATIONS_E2E_API_URL").replace(/\/+$/, "");
const aiBase = required("OPERATIONS_E2E_AI_URL").replace(/\/+$/, "");
const factoryId = process.env.OPERATIONS_E2E_FACTORY_ID || "factory-demo-01";
const adminPassword = required("OPERATIONS_E2E_ADMIN_PASSWORD");
const rolePassword = required("OPERATIONS_E2E_ROLE_PASSWORD");
const viewerUsername = required("OPERATIONS_E2E_VIEWER_USERNAME");
const outsiderUsername = required("OPERATIONS_E2E_OUTSIDER_USERNAME");
const evidenceFile = required("OPERATIONS_E2E_EVIDENCE_FILE");

type JsonObject = Record<string, unknown>;

// Read-only assertions against the harness-owned schema, never a dev DB.
async function databaseQuery(sql: string, ...parameters: unknown[]): Promise<unknown> {
  const url = new URL(required("OPERATIONS_E2E_DATABASE_URL"));
  if (!/_(test|ci)$/.test(url.pathname) || !/^product_api_it_browser_/.test(url.searchParams.get("schema") || "")) {
    throw new Error("Database assertions require a harness-owned test schema");
  }
  const backendRequire = createRequire(path.resolve("../backend/package.json"));
  const { PrismaClient } = backendRequire("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try { return await db.$queryRawUnsafe(sql, ...parameters); }
  finally { await db.$disconnect(); }
}

const publicationState = () => databaseQuery(`SELECT jsonb_build_object(
  'head', (SELECT jsonb_agg(to_jsonb(h)) FROM operations_heads h),
  'schedules', (SELECT jsonb_agg(to_jsonb(s) ORDER BY schedule_id) FROM operation_schedules s),
  'publications', (SELECT jsonb_agg(to_jsonb(c) ORDER BY case_id) FROM decision_commits c)
) AS state`);

async function captureWorkOrders(page: Page, name: string) {
  const original = page.viewportSize();
  for (const [width, height] of [[1440, 900], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`real-work-orders-${name}-${width}x${height}.png`) });
  }
  if (original) await page.setViewportSize(original);
}

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

async function loginContext(browser: Browser, username: string, password: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const response = await context.request.post(`${apiBase}/api/v1/auth/login`, {
    data: { username, password },
  });
  expect(response.status()).toBe(200);
  return context;
}

type ReadyCase = {
  id: string;
  status: JsonObject;
  meta: JsonObject;
  recommendation: JsonObject;
  candidate: JsonObject;
};

async function createReadyCase(
  request: APIRequestContext,
  context: { snapshotId: string; planVersion: number },
  label: string,
): Promise<ReadyCase> {
  const created = await createCase(request, context, liveRequest("LIVE", {
    trigger: { type: "MANUAL_REPLAN", reason: label },
  }));
  expect(created.response.status()).toBe(202);
  const id = string(envelopeData(await json(created.response)).decision_case_id, `${label} case id`);
  await waitForCase(request, id, ["AWAITING_APPROVAL"]);
  const readResponse = await request.get(`${apiBase}/api/v1/decision-cases/${id}`);
  expect(readResponse.status()).toBe(200);
  const read = await json(readResponse);
  const recommendationResponse = await request.get(`${apiBase}/api/v1/decision-cases/${id}/recommendation`);
  expect(recommendationResponse.status()).toBe(200);
  const recommendation = record(envelopeData(await json(recommendationResponse)).recommendation);
  const candidate = array(recommendation.candidate_plans).map(record)
    .find(value => value.candidate_plan_id === recommendation.recommended_plan_id);
  expect(candidate).toBeTruthy();
  return { id, status: envelopeData(read), meta: record(read.meta), recommendation, candidate: candidate! };
}

function commandIdentity(item: ReadyCase) {
  return {
    schema_version: "3.0",
    decision_case_id: item.id,
    recommendation_id: item.recommendation.recommendation_id,
    candidate_plan_id: item.candidate.candidate_plan_id,
    candidate_version: item.candidate.plan_version,
    expected_snapshot_id: item.status.snapshot_id,
    expected_plan_version: item.meta.base_plan_version,
  };
}

async function approveCase(request: APIRequestContext, item: ReadyCase, key = `approve-${randomUUID()}`) {
  const body = { ...commandIdentity(item), command: "APPROVE", expected_case_revision: item.meta.case_revision };
  const response = await request.post(`${apiBase}/api/v1/decision-cases/${item.id}/decision`, {
    headers: { "Idempotency-Key": key }, data: body,
  });
  expect(response.status()).toBe(200);
  const payload = await json(response);
  expect(envelopeData(payload).status).toBe("APPROVED");
  return { body, payload, key };
}

function commitCommand(item: ReadyCase, approved: JsonObject) {
  return {
    ...commandIdentity(item),
    command: "COMMIT",
    expected_case_revision: record(approved.meta).case_revision,
  };
}

const caseDatabaseState = (caseId: string) => databaseQuery(`SELECT jsonb_build_object(
  'case', (SELECT to_jsonb(c) FROM decision_cases c WHERE c.id = $1::uuid),
  'decision', (SELECT to_jsonb(d) FROM decision_human_records d WHERE d.case_id = $1::uuid),
  'commit', (SELECT to_jsonb(c) FROM decision_commits c WHERE c.case_id = $1::uuid),
  'events', (SELECT jsonb_agg(to_jsonb(e) ORDER BY sequence) FROM decision_case_events e WHERE e.case_id = $1::uuid),
  'receipts', (SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at, id) FROM decision_case_idempotency_receipts r WHERE r.case_id = $1::uuid)
) AS state`, caseId);

async function listAllCases(request: APIRequestContext, query: Record<string, string>): Promise<JsonObject[]> {
  const rows: JsonObject[] = [];
  let cursor: string | null = null;
  do {
    const response = await request.get(`${apiBase}/api/v1/decision-cases`, {
      params: { ...query, factory_id: factoryId, limit: "2", ...(cursor ? { cursor } : {}) },
    });
    expect(response.status()).toBe(200);
    const payload = await json(response);
    rows.push(...array(envelopeValue(payload)).map(record));
    const meta = record(payload.meta);
    cursor = meta.has_more ? string(meta.next_cursor, "next cursor") : null;
  } while (cursor);
  expect(new Set(rows.map(row => row.decision_case_id)).size).toBe(rows.length);
  return rows;
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
  await expect(page).toHaveURL(/\/overview(?:\?|$)/);

  await page.goto(`/overview?factory_id=${factoryId}`);
  await expect(page.getByRole("main").getByRole("heading", { name: "Factory Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose machine" })).toBeVisible();
  await expect(page.getByRole("note").first()).toContainText("no fixture fallback");
  for (const width of [1280, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`real-overview-empty-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Choose machine" }).click();
  await expect(page.getByRole("combobox", { name: "Search machines" })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("real-machine-picker-1440.png") });
  await page.getByRole("combobox", { name: "Search machines" }).fill("M03");
  await page.getByRole("combobox", { name: "Search machines" }).press("Enter");
  await expect(page.getByRole("region", { name: "Selected machine detail" })).toContainText("Observed");
  await page.getByRole("region", { name: "Selected machine detail" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("real-machine-detail-1440.png") });
  const contextBefore = await currentContext(page.request);
  const scheduleBefore = await currentSchedule(page.request);

  // Let the real backend commit, then drop only the response seen by the UI.
  const submitted: Array<{ body: string | null; key: string | undefined; caseId: unknown }> = [];
  await page.route(`${apiBase}/api/v1/decision-cases`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    const payload = await response.json();
    submitted.push({ body: route.request().postData(), key: route.request().headers()["idempotency-key"], caseId: payload.data.decision_case_id });
    if (submitted.length === 1) await route.abort("failed");
    else {
      expect(response.headers()["idempotency-replayed"]).toBe("true");
      await route.fulfill({ response });
    }
  });
  await page.getByLabel("Planning reason").fill("Browser E2E planning request");
  await page.getByRole("button", { name: "Create case", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recover create outcome" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Create case", exact: true })).toBeDisabled();
  expect(submitted).toHaveLength(1);
  await page.getByRole("button", { name: "Recover create outcome" }).click();
  await expect(page).toHaveURL(/\/operations\/recommendations\?.*caseId=/);
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(await databaseQuery('SELECT count(*)::int AS count FROM decision_cases WHERE factory_id = $1', factoryId)).toEqual([{ count: 1 }]);
  await page.unroute(`${apiBase}/api/v1/decision-cases`);
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
  const storedRequestRows = array(await databaseQuery('SELECT request_json FROM decision_cases WHERE id = $1::uuid', caseId));
  const storedRequest = record(record(storedRequestRows[0]).request_json);
  const storedCaseRequest = record(storedRequest.request);
  const replayRequest = {
    schema_version: "3.0",
    decision_case_id: caseId,
    mode: "LIVE",
    factory_snapshot: snapshot,
    trigger: {
      ...record(storedCaseRequest.trigger),
      event_id: caseId,
      occurred_at: persistedCase.created_at,
      requested_by_user_id: actorId,
    },
    planning_config: storedCaseRequest.planning_config,
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
  await waitForCase(page.request, simulationCaseId, ["AWAITING_APPROVAL"]);
  const simulationRead = await page.request.get(`${apiBase}/api/v1/decision-cases/${simulationCaseId}`);
  const simulationMeta = record((await json(simulationRead)).meta);
  const simulationArtifact = await page.request.get(`${apiBase}/api/v1/decision-cases/${simulationCaseId}/recommendation`);
  const simulationPackage = record(envelopeData(await json(simulationArtifact)).recommendation);
  const simulationCandidate = array(simulationPackage.candidate_plans).map(record)
    .find(candidate => candidate.candidate_plan_id === simulationPackage.recommended_plan_id)!;
  const commandIdentity = {
    schema_version: "3.0", decision_case_id: simulationCaseId,
    recommendation_id: simulationPackage.recommendation_id,
    candidate_plan_id: simulationCandidate.candidate_plan_id,
    candidate_version: simulationCandidate.plan_version,
    expected_snapshot_id: contextBefore.snapshotId,
    expected_plan_version: contextBefore.planVersion,
  };
  const approve = await page.request.post(`${apiBase}/api/v1/decision-cases/${simulationCaseId}/decision`, {
    headers: { "Idempotency-Key": `sim-approve-${randomUUID()}` },
    data: { ...commandIdentity, command: "APPROVE", expected_case_revision: simulationMeta.case_revision },
  });
  expect(approve.status()).toBe(200);
  const approved = await json(approve);
  expect(envelopeData(approved).status).toBe("APPROVED");
  const beforeCommit = await currentSchedule(page.request);
  const publicationBefore = await publicationState();
  const simulationCommit = await page.request.post(
    `${apiBase}/api/v1/decision-cases/${encodeURIComponent(simulationCaseId)}/decision`,
    {
      headers: { "Idempotency-Key": `sim-commit-${randomUUID()}` },
      data: { ...commandIdentity, command: "COMMIT", expected_case_revision: record(approved.meta).case_revision },
    },
  );
  expect(simulationCommit.status()).toBe(409);
  expect(record((await json(simulationCommit)).error).code).toBe("SIMULATION_ONLY");
  expect(await currentSchedule(page.request)).toEqual(beforeCommit);
  expect(await publicationState()).toEqual(publicationBefore);
  const afterCommit = await page.request.get(`${apiBase}/api/v1/decision-cases/${simulationCaseId}`);
  expect(await json(afterCommit)).toEqual(approved);

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

  // Exercise the actual LIVE UI and actor-scoped decision receipts after the negative checks.
  const decisionSubmissions: Array<{ command: string; key: string | undefined; body: string | null }> = [];
  const decisionCounts = new Map<string, number>();
  const decisionUrl = `${apiBase}/api/v1/decision-cases/${caseId}/decision`;
  await page.route(decisionUrl, async route => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const command = request.postDataJSON().command as string;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const count = (decisionCounts.get(command) ?? 0) + 1;
    decisionCounts.set(command, count);
    decisionSubmissions.push({ command, key: request.headers()["idempotency-key"], body: request.postData() });
    if (count === 1) await route.abort("failed");
    else {
      expect(response.headers()["idempotency-replayed"]).toBe("true");
      await route.fulfill({ response });
    }
  });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByLabel("Decision note").fill("Approve after real services acceptance review");
  await page.getByRole("button", { name: "Confirm approve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recover decision outcome" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Recover decision outcome" }).click();
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled();
  expect(await currentSchedule(page.request)).toEqual(scheduleAfter);
  const approvedRead = await page.request.get(`${apiBase}/api/v1/decision-cases/${caseId}`);
  const approvedPayload = await json(approvedRead);
  const approvedIdentity = record(record(approvedPayload.meta).approved_candidate);
  expect(record(record(approvedPayload.meta).human_decision).actor_id).toBe(actorId);
  await page.getByRole("button", { name: "Commit approved schedule" }).click();
  await expect(page.getByRole("dialog")).toContainText(factoryId);
  await expect(page.getByRole("dialog")).toContainText(string(approvedIdentity.candidate_plan_id, "approved candidate"));
  await page.screenshot({ path: test.info().outputPath("real-commit-confirmation-1440.png") });
  await page.getByRole("button", { name: "Confirm commit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recover decision outcome" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Recover decision outcome" }).click();
  await expect(page.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open this published Gantt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recover decision outcome" })).toHaveCount(0);
  const published = await currentSchedule(page.request);
  expect(published.plan_version).toBe(contextBefore.planVersion + 1);
  const approvedCandidate = candidates.find(candidate => candidate.candidate_plan_id === approvedIdentity.candidate_plan_id)!;
  expect(published.schedule).toEqual(approvedCandidate.schedule);
  expect(record(published.commit).actor_id).toBe(actorId);
  expect(record(published.commit).decision_case_id).toBe(caseId);
  expect(await databaseQuery('SELECT count(*)::int AS count FROM decision_commits WHERE factory_id = $1', factoryId)).toEqual([{ count: 1 }]);
  for (const command of ["APPROVE", "COMMIT"]) {
    const pair = decisionSubmissions.filter(item => item.command === command);
    expect(pair).toHaveLength(2);
    expect(pair[1]).toEqual(pair[0]);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  expect(decisionSubmissions).toHaveLength(4);
  await page.unroute(decisionUrl);

  // Create/read/replay/cancel checkpoint. Full lifecycle and recovery have a
  // separate real-service scenario below; the harness combines both records.
  const workOrderCreateUrl = `${apiBase}/api/v1/work-orders`;
  const workOrderCreates: { key: string | undefined; body: string | null }[] = [];
  await page.route(workOrderCreateUrl, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); // Real backend transaction, no fixture.
    expect(response.status()).toBe(201);
    workOrderCreates.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (workOrderCreates.length === 1) await route.abort("failed");
    else { expect(response.headers()["idempotency-replayed"]).toBe("true"); await route.fulfill({ response }); }
  });
  await page.getByText("Maintenance assignments / Work Orders", { exact: true }).click();
  const assignmentTable = page.getByRole("region", { name: "Published maintenance assignments" });
  await expect(assignmentTable.getByRole("button", { name: "Review create work order" }).first()).toBeEnabled();
  await assignmentTable.getByRole("button", { name: "Review create work order" }).first().click();
  const createWorkOrderDialog = page.getByRole("dialog", { name: "Create work order from this publication" });
  await expect(createWorkOrderDialog).toContainText(factoryId);
  await captureWorkOrders(page, "source-confirmation");
  await createWorkOrderDialog.getByRole("button", { name: "Create work order", exact: true }).click();
  await expect(createWorkOrderDialog.getByRole("button", { name: "Retry original create" })).toBeVisible();
  await createWorkOrderDialog.getByRole("button", { name: "Retry original create" }).click();
  await expect(page).toHaveURL(/\/operations\/work-orders\/[0-9a-f-]+\?factory_id=/);
  const workOrderId = page.url().split("/work-orders/")[1].split("?")[0];
  await expect(page.getByRole("button", { name: "Assign", exact: true })).toBeEnabled();
  expect(workOrderCreates).toHaveLength(2);
  expect(workOrderCreates[1]).toEqual(workOrderCreates[0]);
  expect(await databaseQuery("SELECT count(*)::int AS count FROM work_orders WHERE factory_id=$1", factoryId)).toEqual([{ count: 1 }]);
  const workOrderPayload = JSON.parse(workOrderCreates[0].body!) as JsonObject;
  expect(record(workOrderPayload.source)).toMatchObject({ decision_case_id: caseId, schedule_id: record(published.schedule).schedule_id, schedule_hash: record(published.commit).schedule_hash });
  const sourceAssignment = array(record(published.schedule).assignments).map(record).find(item => item.assignment_id === record(workOrderPayload.source).assignment_id);
  expect(sourceAssignment?.assignment_type).toBe("MAINTENANCE");
  expect(sourceAssignment?.status).not.toBe("CANCELLED");
  await page.reload();
  await expect(page.getByRole("button", { name: "Cancel work order", exact: true })).toBeEnabled();
  await expect(page.getByRole("list", { name: "Work Order events" }).getByRole("listitem")).toHaveCount(1);
  await captureWorkOrders(page, "detail");
  await page.getByRole("link", { name: "Back to filtered work orders" }).click();
  await expect(page.getByRole("link", { name: `Open work order ${workOrderId}` })).toBeVisible();
  await captureWorkOrders(page, "list");
  await page.getByRole("link", { name: `Open work order ${workOrderId}` }).click();
  await expect(page.getByRole("list", { name: "Work Order events" }).getByRole("listitem")).toHaveCount(1);
  await page.unroute(workOrderCreateUrl);

  // Discovery/audit acceptance against the same real API and harness-owned DB.
  // No new cases/commands, mocks or GET interception are introduced here.
  const discoveryWrites: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/v1/decision-cases")) discoveryWrites.push(request.method());
  });
  const listPages: JsonObject[] = [];
  const discovered: JsonObject[] = [];
  let listCursor: string | undefined;
  do {
    const response = await page.request.get(`${apiBase}/api/v1/decision-cases`, {
      params: { factory_id: factoryId, limit: "1", ...(listCursor ? { cursor: listCursor } : {}) },
    });
    expect(response.status()).toBe(200);
    const payload = await json(response);
    const metadata = record(payload.meta);
    expect(metadata.factory_id).toBe(factoryId);
    discovered.push(...array(envelopeValue(payload)).map(record));
    listPages.push(metadata);
    if (!metadata.has_more) break;
    const next = string(metadata.next_cursor, "list next_cursor");
    expect(next).not.toBe(listCursor);
    listCursor = next;
  } while (true);
  expect(discovered.length).toBeGreaterThanOrEqual(3);
  expect(new Set(discovered.map(item => item.decision_case_id)).size).toBe(discovered.length);
  expect(discovered.find(item => item.decision_case_id === caseId)?.publication).toMatchObject({ actor_id: actorId, plan_version: published.plan_version });
  const freshEvents: JsonObject[] = [];
  const auditPages: JsonObject[] = [];
  let afterSequence = 0;
  do {
    const response = await page.request.get(`${apiBase}/api/v1/decision-cases/${caseId}/events`, {
      params: { after_sequence: String(afterSequence), limit: "1" },
    });
    expect(response.status()).toBe(200);
    const payload = await json(response);
    freshEvents.push(...array(envelopeValue(payload)).map(record));
    const metadata = record(payload.meta);
    auditPages.push(metadata);
    if (!metadata.has_more) break;
    const next = number(metadata.next_after_sequence, "audit next_after_sequence");
    expect(next).toBeGreaterThan(afterSequence);
    afterSequence = next;
  } while (true);
  const freshSequences = freshEvents.map(item => number(item.sequence, "event sequence"));
  expect(new Set(freshSequences).size).toBe(freshSequences.length);
  expect(freshEvents.filter(item => record(item.payload).command === "COMMIT")).toHaveLength(1);
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/operations/cases?${new URLSearchParams({ factory_id: factoryId })}`);
    await expect(page.getByRole("button", { name: "Refresh cases" })).toBeEnabled();
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("COMMITTED");
    await page.getByRole("combobox", { name: "Case mode", exact: true }).selectOption("LIVE");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("COMMITTED");
    await expect(page.getByRole("combobox", { name: "Case mode", exact: true })).toHaveValue("LIVE");
    const open = page.getByRole("link", { name: `Open recommendation for ${caseId}` });
    await expect(open).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`real-case-list-${name}.png`), fullPage: true });
    await open.click();
    await expect(page).toHaveURL(new RegExp(`recommendations\\?.*caseId=${caseId}`));
    const timeline = page.getByRole("list", { name: "Decision case audit events" });
    await expect(timeline.getByRole("listitem")).toHaveCount(freshEvents.length);
    expect(await timeline.getByRole("listitem").evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("data-sequence"))))).toEqual(freshSequences);
    await page.goBack();
    await expect(page).toHaveURL(/status=COMMITTED&mode=LIVE/);
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("COMMITTED");
    await expect(page.getByRole("combobox", { name: "Case mode", exact: true })).toHaveValue("LIVE");
    await expect(page.getByRole("article")).toHaveCount(1);
    await open.click();
    await expect(timeline.getByRole("listitem")).toHaveCount(freshEvents.length);
    await page.locator("#decision-case-audit").screenshot({ path: test.info().outputPath(`real-case-audit-${name}.png`), style: "header.sticky { visibility: hidden !important; }" });
    await page.getByRole("button", { name: "Refresh history" }).click();
    await expect(page.getByRole("button", { name: "Refresh history" })).toBeEnabled();
    await expect(timeline.getByRole("listitem")).toHaveCount(freshEvents.length);
    await page.reload();
    await expect(timeline.getByRole("listitem")).toHaveCount(freshEvents.length);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(discoveryWrites).toEqual([]);
  const completedDiscoveryWrites = [...discoveryWrites];
  // REJECT is exercised against the real worker artifact and must not publish anything.
  const rejectBasis = await currentContext(page.request);
  const rejectCase = await createReadyCase(page.request, rejectBasis, "Real-service rejection");
  const rejectScheduleBefore = await currentSchedule(page.request);
  const rejectPublicationBefore = await publicationState();
  const rejectResponse = await page.request.post(`${apiBase}/api/v1/decision-cases/${rejectCase.id}/decision`, {
    headers: { "Idempotency-Key": `reject-${randomUUID()}` },
    data: {
      schema_version: "3.0", command: "REJECT", decision_case_id: rejectCase.id,
      recommendation_id: rejectCase.recommendation.recommendation_id,
      expected_snapshot_id: rejectCase.status.snapshot_id,
      expected_case_revision: rejectCase.meta.case_revision,
      expected_plan_version: rejectCase.meta.base_plan_version,
      note: "Rejected by the real-service browser acceptance flow",
    },
  });
  expect(rejectResponse.status()).toBe(200);
  expect(envelopeData(await json(rejectResponse)).status).toBe("REJECTED");
  expect(await currentSchedule(page.request)).toEqual(rejectScheduleBefore);
  expect(await publicationState()).toEqual(rejectPublicationBefore);
  const rejectEventsResponse = await page.request.get(`${apiBase}/api/v1/decision-cases/${rejectCase.id}/events`);
  const rejectEvents = array(envelopeValue(await json(rejectEventsResponse))).map(record);
  expect(record(rejectEvents.at(-1)!.payload)).toMatchObject({ command: "REJECT", candidate_plan_id: null });
  expect(record(rejectEvents.at(-1)!.actor).id).toBe(actorId);

  // Keep a stale confirmation open while another valid case advances the head.
  const staleBasis = await currentContext(page.request);
  const staleSubject = await createReadyCase(page.request, staleBasis, "Stale confirmation subject");
  const staleAdvancer = await createReadyCase(page.request, staleBasis, "Stale confirmation head advancer");
  const staleSubjectApproval = await approveCase(page.request, staleSubject);
  const staleAdvancerApproval = await approveCase(page.request, staleAdvancer);
  const staleSubjectBefore = await caseDatabaseState(staleSubject.id);
  await page.goto(`/operations/recommendations?caseId=${encodeURIComponent(staleSubject.id)}`);
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled();
  await page.getByRole("button", { name: "Commit approved schedule" }).click();
  await expect(page.getByRole("heading", { name: "Confirm commit" })).toBeVisible();

  const advancingCommit = commitCommand(staleAdvancer, staleAdvancerApproval.payload);
  const advancingResponse = await page.request.post(`${apiBase}/api/v1/decision-cases/${staleAdvancer.id}/decision`, {
    headers: { "Idempotency-Key": `stale-advance-${randomUUID()}` }, data: advancingCommit,
  });
  expect(advancingResponse.status()).toBe(200);
  expect(envelopeData(await json(advancingResponse)).status).toBe("COMMITTED");

  const staleDecisionUrl = `${apiBase}/api/v1/decision-cases/${staleSubject.id}/decision`;
  const staleSubmissions: Array<{ key?: string; body: JsonObject; status: number; response: JsonObject }> = [];
  await page.route(staleDecisionUrl, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    const bytes = await response.body();
    staleSubmissions.push({
      key: route.request().headers()["idempotency-key"],
      body: record(route.request().postDataJSON()),
      status: response.status(),
      response: record(JSON.parse(bytes.toString("utf8"))),
    });
    await route.fulfill({ response, body: bytes });
  });
  await page.getByRole("button", { name: "Confirm commit", exact: true }).click();
  await expect(page.locator('p[role="alert"]').filter({ hasText: "Refresh and review again" })).toContainText(
    "this request will not be resubmitted with new tokens",
  );
  await expect(page.getByRole("button", { name: "I have reviewed the refreshed case" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeDisabled();
  expect(staleSubmissions).toHaveLength(1);
  expect(staleSubmissions[0].status).toBe(409);
  expect(record(staleSubmissions[0].response.error).code).toBe("PLAN_VERSION_CONFLICT");
  expect(staleSubmissions[0].body).toMatchObject({
    expected_plan_version: staleBasis.planVersion,
    expected_case_revision: record(staleSubjectApproval.payload.meta).case_revision,
  });
  await page.waitForTimeout(500);
  expect(staleSubmissions).toHaveLength(1);
  expect(await caseDatabaseState(staleSubject.id)).toEqual(staleSubjectBefore);
  await page.unroute(staleDecisionUrl);

  // Two approved LIVE cases race without assigning either one as the expected winner.
  const raceBasis = await currentContext(page.request);
  const raceCases = await Promise.all([
    createReadyCase(page.request, raceBasis, "Commit race case A"),
    createReadyCase(page.request, raceBasis, "Commit race case B"),
  ]);
  const raceApprovals = await Promise.all(raceCases.map(item => approveCase(page.request, item)));
  const raceCommands = raceCases.map((item, index) => commitCommand(item, raceApprovals[index].payload));
  const raceKeys = raceCases.map(() => `race-commit-${randomUUID()}`);
  const raceScheduleBefore = await currentSchedule(page.request);
  const raceCountsBefore = array(await databaseQuery(`SELECT
    (SELECT count(*)::int FROM decision_commits) AS publications,
    (SELECT count(*)::int FROM operation_schedules) AS schedules`))[0] as JsonObject;
  const raceCaseStateBefore = await Promise.all(raceCases.map(item => caseDatabaseState(item.id)));
  const raceResponses = await Promise.all(raceCases.map((item, index) => page.request.post(
    `${apiBase}/api/v1/decision-cases/${item.id}/decision`,
    { headers: { "Idempotency-Key": raceKeys[index] }, data: raceCommands[index] },
  )));
  expect(raceResponses.map(response => response.status()).sort()).toEqual([200, 409]);
  const racePayloads = await Promise.all(raceResponses.map(json));
  const winnerIndex = raceResponses.findIndex(response => response.status() === 200);
  const loserIndex = raceResponses.findIndex(response => response.status() === 409);
  expect(winnerIndex).toBeGreaterThanOrEqual(0);
  expect(loserIndex).toBeGreaterThanOrEqual(0);
  const winner = raceCases[winnerIndex];
  const loser = raceCases[loserIndex];
  expect(record(racePayloads[loserIndex].error).code).toBe("PLAN_VERSION_CONFLICT");

  const winnerReplay = await page.request.post(`${apiBase}/api/v1/decision-cases/${winner.id}/decision`, {
    headers: { "Idempotency-Key": raceKeys[winnerIndex] }, data: raceCommands[winnerIndex],
  });
  expect(winnerReplay.status()).toBe(200);
  expect(winnerReplay.headers()["idempotency-replayed"]).toBe("true");
  expect(await json(winnerReplay)).toEqual(racePayloads[winnerIndex]);
  const loserReplay = await page.request.post(`${apiBase}/api/v1/decision-cases/${loser.id}/decision`, {
    headers: { "Idempotency-Key": raceKeys[loserIndex] }, data: raceCommands[loserIndex],
  });
  expect(loserReplay.status()).toBe(409);
  expect(record((await json(loserReplay)).error).code).toBe("PLAN_VERSION_CONFLICT");

  const racePublished = await currentSchedule(page.request);
  expect(racePublished.plan_version).toBe(number(raceScheduleBefore.plan_version, "race base plan version") + 1);
  expect(racePublished.schedule).toEqual(winner.candidate.schedule);
  expect(record(racePublished.commit).decision_case_id).toBe(winner.id);
  expect(record(racePublished.commit).actor_id).toBe(actorId);
  const raceCountsAfter = array(await databaseQuery(`SELECT
    (SELECT count(*)::int FROM decision_commits) AS publications,
    (SELECT count(*)::int FROM operation_schedules) AS schedules`))[0] as JsonObject;
  expect(raceCountsAfter).toEqual({
    publications: number(raceCountsBefore.publications, "publication count") + 1,
    schedules: number(raceCountsBefore.schedules, "schedule count") + 1,
  });
  expect(await caseDatabaseState(loser.id)).toEqual(raceCaseStateBefore[loserIndex]);
  expect(await databaseQuery('SELECT case_id::text FROM decision_commits WHERE case_id IN ($1::uuid, $2::uuid)', raceCases[0].id, raceCases[1].id))
    .toEqual([{ case_id: winner.id }]);

  const winnerReadResponse = await page.request.get(`${apiBase}/api/v1/decision-cases/${winner.id}`);
  const winnerRead = await json(winnerReadResponse);
  expect(envelopeData(winnerRead).status).toBe("COMMITTED");
  expect(record(record(winnerRead.meta).commit).actor_id).toBe(actorId);
  const winnerEventsResponse = await page.request.get(`${apiBase}/api/v1/decision-cases/${winner.id}/events`);
  const winnerEvents = array(envelopeValue(await json(winnerEventsResponse))).map(record);
  expect(winnerEvents.slice(-2).map(event => record(event.payload).command)).toEqual(["APPROVE", "COMMIT"]);
  expect(winnerEvents.slice(-2).every(event => record(event.actor).id === actorId)).toBe(true);
  const winnerDatabaseEvents = array(await databaseQuery(
    'SELECT sequence, type, actor_id, actor_kind, occurred_at, payload_json FROM decision_case_events WHERE case_id=$1::uuid ORDER BY sequence',
    winner.id,
  )).map(record);
  expect(winnerEvents).toHaveLength(winnerDatabaseEvents.length);
  for (const [index, event] of winnerEvents.entries()) {
    const stored = winnerDatabaseEvents[index];
    expect(event.sequence).toBe(stored.sequence);
    expect(event.type).toBe(stored.type);
    expect(record(event.actor)).toEqual({ kind: stored.actor_kind, id: stored.actor_id });
    expect(Date.parse(string(event.occurred_at, "event occurred_at"))).toBe(new Date(stored.occurred_at as string | Date).getTime());
    expect(record(stored.payload_json)).toMatchObject(record(event.payload));
  }

  // A granted VIEWER can read/list but cannot write; an ungranted VIEWER cannot discover the factory or case.
  const viewer = await loginContext(browser, viewerUsername, rolePassword);
  const viewerRead = await viewer.request.get(`${apiBase}/api/v1/decision-cases/${winner.id}`);
  expect(viewerRead.status()).toBe(200);
  expect(record((await json(viewerRead)).meta).available_commands).toEqual([]);
  const viewerPage = await viewer.newPage();
  await viewerPage.goto(`/operations/recommendations?factory_id=${factoryId}&caseId=${winner.id}`);
  await expect(viewerPage.getByText(/VIEWER access is read-only/)).toBeVisible();
  for (const name of ["Approve", "Reject", "Commit approved schedule", "Modify", "Recover decision outcome"]) await expect(viewerPage.getByRole("button", { name, exact: true })).toHaveCount(0);
  const viewerWrite = await viewer.request.post(`${apiBase}/api/v1/decision-cases/${loser.id}/decision`, {
    headers: { "Idempotency-Key": `viewer-forbidden-${randomUUID()}` }, data: raceCommands[loserIndex],
  });
  expect(viewerWrite.status()).toBe(403);
  expect(record((await json(viewerWrite)).error).code).toBe("FORBIDDEN");
  const liveRows = await listAllCases(viewer.request, { mode: "LIVE" });
  expect(liveRows.map(row => row.decision_case_id)).toEqual(expect.arrayContaining([winner.id, loser.id, rejectCase.id]));
  const committedRows = await listAllCases(viewer.request, { status: "COMMITTED" });
  expect(committedRows.some(row => row.decision_case_id === winner.id)).toBe(true);
  const rejectedRows = await listAllCases(viewer.request, { status: "REJECTED" });
  expect(rejectedRows.map(row => row.decision_case_id)).toContain(rejectCase.id);
  await viewerPage.goto(`/operations/work-orders/${workOrderId}?factory_id=${factoryId}`);
  await expect(viewerPage.getByText("VIEWER access is read-only.", { exact: true })).toBeVisible();
  await expect(viewerPage.getByRole("region", { name: "Work Order commands" }).getByRole("button")).toHaveCount(0);
  await captureWorkOrders(viewerPage, "viewer-detail");
  const viewerWorkOrderWrite = await viewer.request.post(`${apiBase}/api/v1/work-orders/${workOrderId}/commands`, {
    headers: { "Idempotency-Key": `viewer-work-order-forbidden-${randomUUID()}` }, data: { command: "CANCEL", expected_revision: 1, reason: "Negative authorization test" },
  });
  expect(viewerWorkOrderWrite.status()).toBe(403);
  const outsider = await loginContext(browser, outsiderUsername, rolePassword);
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto(`/overview?factory_id=${factoryId}`);
  await expect(outsiderPage.getByRole("heading", { name: "Factory context unavailable" })).toBeVisible();
  await outsiderPage.screenshot({ path: test.info().outputPath("real-overview-inaccessible-1440.png") });
  for (const response of [
    await outsider.request.get(`${apiBase}/api/v1/operations/snapshot`, { params: { factory_id: factoryId } }),
    await outsider.request.get(`${apiBase}/api/v1/decision-cases`, { params: { factory_id: factoryId } }),
    await outsider.request.get(`${apiBase}/api/v1/decision-cases/${winner.id}`),
  ]) {
    expect(response.status()).toBe(404);
    const payload = await json(response);
    const publicError = record(payload.error ?? payload);
    expect(publicError.code).toMatch(/^(FACTORY_NOT_FOUND|DECISION_CASE_NOT_FOUND)$/);
    expect(JSON.stringify(payload)).not.toContain(winner.id);
  }
  await outsiderPage.goto(`/operations/work-orders/${workOrderId}?factory_id=${factoryId}`);
  await expect(outsiderPage.getByRole("heading", { name: "Work Orders unavailable or inaccessible" })).toBeVisible();
  await expect(outsiderPage.getByRole("heading", { name: "Historical source and provenance" })).toHaveCount(0);
  await captureWorkOrders(outsiderPage, "inaccessible");
  for (const suffix of [`?factory_id=${factoryId}`, `/${workOrderId}`, `/${workOrderId}/events`]) {
    const response = await outsider.request.get(`${apiBase}/api/v1/work-orders${suffix}`);
    expect(response.status()).toBe(404);
    expect(JSON.stringify(await json(response))).not.toContain(workOrderId);
  }
  await viewer.close();
  await outsider.close();

  // Rediscover the committed case through a paged service read after closing the tab, then reopen it in a new tab.
  expect(liveRows.some(row => row.decision_case_id === winner.id)).toBe(true);
  const adminContext = page.context();
  await page.close();
  const reopened = await adminContext.newPage();
  await reopened.goto(`/operations/recommendations?caseId=${encodeURIComponent(winner.id)}`);
  await expect(reopened.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  await expect(reopened.getByText(winner.id, { exact: true }).first()).toBeVisible();

  // Exercise the shipped transport adapter against the real API, not a fixture server.
  // Compare the shipped summary adapter with PostgreSQL, then verify the same
  // authoritative buckets and preview through the redesigned production page.
  await expect.poll(async () => {
    const rows = array(await databaseQuery("SELECT count(*)::int AS count FROM decision_cases WHERE factory_id = $1 AND processing_status IN ('PENDING', 'RUNNING')", factoryId));
    return record(rows[0]).count;
  }, { timeout: 90_000 }).toBe(0);
  const overviewClient = createOperationsApiClient({ baseUrl: `${apiBase}/api/v1`, fetcher: async (url, init) => {
    expect(init?.method).toBe("GET");
    const response = await adminContext.request.get(String(url));
    return new Response(await response.text(), { status: response.status(), headers: response.headers() });
  } });
  const beforeOverview = await publicationState();
  const overview = await overviewClient.getOperationsOverview(factoryId);
  const groups = array(await databaseQuery("SELECT mode, status, processing_status, count(*)::int AS count FROM decision_cases WHERE factory_id = $1 GROUP BY mode, status, processing_status", factoryId));
  for (const mode of ["LIVE", "SIMULATION_ONLY"] as const) {
    const expected = { total: 0, by_status: zeroBuckets(caseStatuses), by_processing: zeroBuckets(processingStatuses) };
    for (const row of groups.map(record).filter(row => row.mode === mode)) {
      const count = number(row.count, "case count");
      expected.total += count;
      expected.by_status[row.status as keyof typeof expected.by_status] += count;
      expected.by_processing[row.processing_status as keyof typeof expected.by_processing] += count;
    }
    expect(overview.cases[mode]).toEqual(expected);
  }
  const previewRows = array(await databaseQuery("SELECT id::text FROM decision_cases WHERE factory_id = $1 AND mode = 'LIVE' AND status = 'AWAITING_APPROVAL' ORDER BY created_at DESC, id DESC LIMIT 6", factoryId));
  expect(overview.review_preview.items.map(item => item.decision_case_id)).toEqual(previewRows.map(row => record(row).id));
  const heads = array(await databaseQuery("SELECT snapshot_id, plan_version, revision FROM operations_heads WHERE factory_id = $1", factoryId));
  expect(overview.context).toMatchObject({ snapshot_id: record(heads[0]).snapshot_id, plan_version: record(heads[0]).plan_version, head_revision: record(heads[0]).revision });
  const overviewSnapshot = await overviewClient.getOperationsSnapshot(factoryId);
  expect(overview.machines.total).toBe(overviewSnapshot.snapshot.machines.length);
  for (const [status, count] of Object.entries(overview.machines.by_status)) {
    expect(count).toBe(overviewSnapshot.snapshot.machines.filter(machine => machine.status === status).length);
  }
  expect(await publicationState()).toEqual(beforeOverview);

  await reopened.setViewportSize({ width: 1440, height: 1000 });
  await reopened.goto(`/overview?factory_id=${factoryId}`);
  const awaitingCard = reopened.getByRole("link", { name: "LIVE cases awaiting approval" });
  await expect(awaitingCard).toContainText(String(overview.cases.LIVE.by_status.AWAITING_APPROVAL));
  await expect(awaitingCard).toHaveAttribute("href", `/operations/cases?factory_id=${factoryId}&status=AWAITING_APPROVAL&mode=LIVE`);
  await expect(reopened.getByRole("region", { name: "Factory read context" })).toContainText(overview.context.snapshot_id);
  await reopened.screenshot({ path: test.info().outputPath("real-overview-review-1440.png") });
  const observationsBefore = await publicationState();
  // Advance observation only through the existing trusted ingestion service on
  // this harness-owned schema; no backend changes, SQL mutation or new endpoint.
  const testUrl = new URL(required("OPERATIONS_E2E_DATABASE_URL"));
  if (!/_(test|ci)$/.test(testUrl.pathname) || !/^product_api_it_browser_/.test(testUrl.searchParams.get("schema") || "")) throw new Error("Expected isolated test schema");
  const backendRequire = createRequire(path.resolve("../backend/package.json"));
  const { PrismaClient } = backendRequire("@prisma/client");
  const { ingestFactorySnapshot } = backendRequire("./src/services/operations-snapshot.service");
  const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  const nextSnapshot = { ...overviewSnapshot.snapshot, snapshot_id: `${overviewSnapshot.snapshot_id}-S2`,
    captured_at: new Date(Date.parse(overviewSnapshot.captured_at) + 1000).toISOString(), current_schedule: null,
    machines: overviewSnapshot.snapshot.machines.map(machine => ({ ...machine, display_name: `S2 ${machine.display_name}` })) };
  try { await ingestFactorySnapshot({ factoryId, expectedHeadRevision: overview.context.head_revision, snapshot: nextSnapshot, sourceId: "browser-acceptance" }, db); }
  finally { await db.$disconnect(); }
  await reopened.getByRole("button", { name: "Refresh overview" }).click();
  await expect(reopened.getByRole("region", { name: "Factory read context" })).toContainText(nextSnapshot.snapshot_id);
  await expect(reopened.getByRole("region", { name: "Published factory plan" })).toContainText(string(record(racePublished.basis_snapshot).snapshot_id, "published immutable basis"));
  await reopened.screenshot({ path: test.info().outputPath("real-overview-S2-P1-1440.png") });
  await reopened.getByRole("link", { name: "Open integrated schedule" }).click();
  await expect(reopened).toHaveURL(/\/operations\/schedule\?factory_id=/);
  await expect(reopened.getByRole("heading", { name: "Current committed schedule", exact: true })).toBeVisible();
  const context = reopened.getByRole("region", { name: "Schedule context" });
  await expect(context.getByText("Observation snapshot ID").locator("..")).toContainText(nextSnapshot.snapshot_id);
  await expect(context.getByText("Published basis snapshot ID").locator("..")).toContainText(string(record(racePublished.basis_snapshot).snapshot_id, "old basis"));
  await expect(reopened.getByText(/^S2 CNC/)).toHaveCount(0);
  await reopened.screenshot({ path: test.info().outputPath("real-current-Gantt-S2-P1-1440.png") });
  await reopened.goto(`/operations/schedule?factory_id=${factoryId}&caseId=${caseId}`);
  await expect(reopened.getByRole("heading", { name: "Published case schedule", exact: true }).last()).toBeVisible();
  await expect(reopened.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  await expect(reopened.getByText(`Published plan version ${published.plan_version}`, { exact: false })).toBeVisible();
  await reopened.screenshot({ path: test.info().outputPath("real-original-published-Gantt-1440.png") });
  const scheduleAfterS2 = await currentSchedule(adminContext.request);
  expect(scheduleAfterS2.schedule).toEqual(racePublished.schedule);
  expect(scheduleAfterS2.basis_snapshot).toEqual(racePublished.basis_snapshot);
  expect(scheduleAfterS2.plan_version).toBe(racePublished.plan_version);
  expect(scheduleAfterS2.snapshot_id).toBe(nextSnapshot.snapshot_id);
  await reopened.goto(`/operations/work-orders/${workOrderId}?factory_id=${factoryId}`);
  await expect(reopened.getByText("Historical source publication", { exact: true })).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Cancel work order", exact: true })).toBeEnabled();
  await reopened.getByRole("link", { name: "Open exact published plan" }).click();
  await expect(reopened).toHaveURL(/schedule_id=.*schedule_revision=.*assignment_id=/);
  await expect(reopened.getByText(/Selected source assignment:/)).toContainText(string(record(workOrderPayload.source).assignment_id, "work order source assignment"));
  await reopened.screenshot({ path: test.info().outputPath("real-work-order-historical-source-1440.png") });
  await reopened.goto(`/operations/work-orders/${workOrderId}?factory_id=${factoryId}`);
  await reopened.getByRole("button", { name: "Cancel work order", exact: true }).click();
  await reopened.getByRole("dialog").getByLabel("Reason", { exact: true }).fill("Manager reviewed cancellation of unstarted historical work");
  await reopened.getByRole("dialog").getByRole("button", { name: "Confirm cancel work order", exact: true }).click();
  await expect(reopened.getByText("Cancellation reason:", { exact: false })).toBeVisible();
  await expect(reopened.getByRole("list", { name: "Work Order events" }).getByRole("listitem")).toHaveCount(2);
  await reopened.reload();
  await expect(reopened.getByRole("list", { name: "Work Order events" }).getByRole("listitem")).toHaveCount(2);
  expect(await databaseQuery("SELECT status,revision FROM work_orders WHERE id=$1::uuid", workOrderId)).toEqual([{ status: "CANCELLED", revision: 2 }]);
  await captureWorkOrders(reopened, "cancel-history");
  const observationsAfter = await publicationState();
  expect(record(array(observationsAfter)[0]).state).toMatchObject({ schedules: record(record(array(observationsBefore)[0]).state).schedules, publications: record(record(array(observationsBefore)[0]).state).publications });

  const evidence = {
    overview_dependency: {
      backend_pr: "https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc/pull/45",
      backend_sha: "9404ecb35810501d82f1428e9ccadcc77275bf35",
      frontend_redesign_sha: required("OPERATIONS_E2E_GIT_SHA"),
      scope: "real production Overview entrypoint, picker, create, worker, approval, commit, published Gantt and audit",
    },
    runtime: { node: process.version, postgresql: await databaseQuery("SHOW server_version") },
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
    published_plan_version: racePublished.plan_version,
    race_winner_case_id: winner.id,
    race_loser_case_id: loser.id,
    decision_submissions: decisionSubmissions,
    case_discovery: { list_pages: listPages, audit_pages: auditPages, event_sequences: freshSequences,
      viewports: ["desktop", "mobile"], case_commands: completedDiscoveryWrites, read_interception: false },
    work_orders_workspace: { milestone: "M1 plus partial M2", work_order_id: workOrderId,
      real_ui_create_read_cancel: "passed", original_create_key_body_replay: "passed", source_S1_P1_preserved_after_S2_P2: "passed", viewer_read_write_denied: "passed", outsider_scoped_404: "passed",
      complete_lifecycle_recovery: "NOT_VERIFIED", pending: ["See separate maintenance-lifecycle.json acceptance"],
      incident_linked_acceptance: "NOT_VERIFIED" },
    checks: {
      overview_adapter_counts_preview_head_match_database: "passed",
      redesigned_overview_entrypoint: "passed",
      observation_S2_preserves_published_basis_S1: "passed",
      exact_case_publication_not_latest_head: "passed",
      real_fastapi_recommendation: "passed",
      exact_same_request_replay: "passed",
      unauthorized_access: "passed",
      stale_case_creation: "passed",
      lost_create_response_receipt_replay: "passed",
      simulation_commit_rejected: "passed",
      planner_failure_preserved_schedule: "passed",
      reload_preserved_recommendation: "passed",
      decision_write_http_status: simulationCommit.status(),
      full_approval_commit_flow: "passed",
      stale_decision_command: "passed",
      competing_commits: "passed",
      decision_command_receipt_replay: "passed",
      real_service_reject: "passed",
      read_only_role: "passed",
      factory_isolation: "passed",
      case_list_filter_and_pagination: "passed",
      close_reopen_case_recovery: "passed",
      audit_timeline_matches_postgresql: "passed",
      frontend_case_list_navigation: "passed",
      case_list_scoped_cursor: "passed",
      case_filters_and_reopen: "passed",
      case_filters_survive_browser_back: "passed",
      complete_audit_refresh_reload: "passed",
      discovery_audit_desktop_mobile: "passed",
      discovery_refresh_is_read_only: "passed",
    },
  };
  await mkdir(path.dirname(evidenceFile), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await test.info().attach("operations-e2e-evidence", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
});

test("Maintenance Workspace real picker, outcomes and revoked-assignee recoveries", async ({ browser }) => {
  test.setTimeout(600_000);
  const admin = await loginContext(browser, "admin", adminPassword);
  const operator = await loginContext(browser, "maintenance_e2e_operator", rolePassword);
  const replacement = await loginContext(browser, "maintenance_e2e_replacement", rolePassword);
  const engineer = await loginContext(browser, "maintenance_e2e_engineer", rolePassword);
  const managerPage = await admin.newPage();
  const opPage = await operator.newPage();
  const replacementPage = await replacement.newPage();
  const engineerPage = await engineer.newPage();
  for (const page of [managerPage, opPage, replacementPage, engineerPage]) page.setDefaultTimeout(30_000);
  const users = envelopeValue(await json(await admin.request.get(`${apiBase}/api/v1/users`))) as JsonObject[];
  const op = users.find(u => u.username === "maintenance_e2e_operator")!;
  const other = users.find(u => u.username === "maintenance_e2e_replacement")!;
  const orders: {id: string; outcome: string; recovery: boolean}[] = [];
  const submissions: {key: string | undefined; body: string | null}[] = [];
  async function read(id: string) {
    const response = await admin.request.get(`${apiBase}/api/v1/work-orders/${id}`);
    expect(response.status()).toBe(200); return envelopeData(await json(response));
  }
  async function open(page: Page, id: string) {
    await page.goto(`/operations/work-orders/${id}?factory_id=${factoryId}`);
    await expect(page.getByRole("heading", {name: "Historical source and provenance"})).toBeVisible();
  }
  async function action(page: Page, id: string, label: string, fill?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>) {
    await open(page, id);
    await page.getByRole("button", {name: label, exact: true}).click();
    if (fill) {
      const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await fill(dialog);
      const response = page.waitForResponse(r => r.url().endsWith(`/work-orders/${id}/commands`) && r.request().method() === "POST");
      await dialog.getByRole("button", {name: `Confirm ${label.toLowerCase()}`, exact: true}).click();
      expect((await response).status()).toBe(200);
      await expect(dialog).not.toBeVisible();
    }
  }
  const reason = async (dialog: ReturnType<Page["getByRole"]>) => { await dialog.getByLabel("Reason", {exact:true}).fill("Independent maintenance acceptance review"); };
  const assign = (username: string, withReason: boolean) => async (dialog: ReturnType<Page["getByRole"]>) => {
    // Select only a username supplied by the real scoped directory endpoint.
    await expect(dialog.getByRole("option", {name: username, exact:true})).toHaveCount(1);
    await dialog.getByLabel("Eligible assignee", {exact:true}).selectOption({label: username});
    if(withReason) await reason(dialog);
  };
  async function complete(page: Page, id: string, outcome: string) {
    await action(page, id, "Report completion", async dialog => {
      await dialog.getByLabel("Outcome", {exact:true}).selectOption(outcome);
      await dialog.getByLabel("Work performed", {exact:true}).fill("Inspected and serviced the reported component");
      await dialog.getByLabel("Result", {exact:true}).fill("Recorded observed maintenance result");
      if(outcome === "STOPPED") await dialog.getByLabel("Stop reason (required)", {exact:true}).fill("Replacement component unavailable");
    });
    expect((await read(id)).status).toBe("COMPLETED");
  }
  try {
    for (const outcome of ["PARTIAL", "STOPPED", "SUCCESS"]) {
      const ready = await createReadyCase(admin.request, await currentContext(admin.request), `Maintenance ${outcome} lifecycle`);
      const approved = await approveCase(admin.request, ready);
      const committed = await admin.request.post(`${apiBase}/api/v1/decision-cases/${ready.id}/decision`, {headers:{"Idempotency-Key":randomUUID()},data:commitCommand(ready, approved.payload)});
      expect(committed.status()).toBe(200);
      await managerPage.goto(`/operations/schedule?factory_id=${factoryId}&caseId=${ready.id}`);
      await managerPage.getByText("Maintenance assignments / Work Orders", {exact:true}).click();
      await managerPage.getByRole("button", {name:"Review create work order",exact:true}).first().click();
      await managerPage.getByRole("dialog").getByRole("button", {name:"Create work order",exact:true}).click();
      await expect(managerPage).toHaveURL(/\/operations\/work-orders\/[0-9a-f-]+\?/);
      const id = managerPage.url().split("/work-orders/")[1].split("?")[0];
      const row = await read(id);
      const origin = await admin.request.get(`${apiBase}/api/v1/work-orders/by-origin`, {params:{factory_id:factoryId,schedule_id:String(record(row.source).schedule_id),schedule_revision:String(record(row.source).schedule_revision),assignment_id:String(record(row.source).assignment_id)}});
      expect(envelopeData(await json(origin)).id).toBe(id);
      // The same origin opens through the shipped publication UI without another POST.
      await managerPage.goto(`/operations/schedule?factory_id=${factoryId}&caseId=${ready.id}`);
      await managerPage.getByText("Maintenance assignments / Work Orders", {exact:true}).click();
      await managerPage.getByRole("button", {name:"Find existing work order",exact:true}).first().click();
      await managerPage.getByRole("link", {name:"Open existing work order",exact:true}).first().click();
      await expect(managerPage).toHaveURL(new RegExp(`/work-orders/${id}\\?`));
      const publicationBeforeCommands = await publicationState();
      await action(managerPage,id,"Assign",assign("maintenance_e2e_operator",false));
      if(outcome === "SUCCESS") {
        await action(managerPage,id,"Reassign",assign("maintenance_e2e_replacement",true));
        await action(replacementPage,id,"Accept work");
        await expect.poll(async()=> (await read(id)).status).toBe("ACCEPTED");
        await action(replacementPage,id,"Start work");
        await expect.poll(async()=> (await read(id)).status).toBe("IN_PROGRESS");
        const started = (await read(id)).actual_started_at;
        await action(replacementPage,id,"Report blocker",reason);
        await action(replacementPage,id,"Resume work",reason);
        expect((await admin.request.patch(`${apiBase}/api/v1/users/${other.id}`,{data:{role:"VIEWER"}})).status()).toBe(200);
        await action(managerPage,id,"Manager hold",reason);
        await action(managerPage,id,"Reassign",assign("maintenance_e2e_operator",true));
        await action(opPage,id,"Accept work");
        await expect.poll(async()=> (await read(id)).status).toBe("ACCEPTED");
        await action(opPage,id,"Start work");
        await expect.poll(async()=> (await read(id)).status).toBe("IN_PROGRESS");
        expect((await read(id)).actual_started_at).toBe(started);
        await open(opPage,id);
        await opPage.getByRole("button",{name:"Report completion",exact:true}).click();
        const staleDialog=opPage.getByRole("dialog");
        await staleDialog.getByLabel("Work performed",{exact:true}).fill("Concurrent inspection");
        await staleDialog.getByLabel("Result",{exact:true}).fill("Review stale revision");
        const conflictUrl=`${apiBase}/api/v1/work-orders/${id}/commands`;
        await opPage.route(conflictUrl,async route=>{
          // Race the frozen real UI request against a real managerial command.
          await action(managerPage,id,"Manager hold",reason); await route.continue();
        });
        const conflict=opPage.waitForResponse(r=>r.url().endsWith(`/work-orders/${id}/commands`)&&r.request().method()==="POST");
        await staleDialog.getByRole("button",{name:"Confirm report completion",exact:true}).click();
        expect((await conflict).status()).toBe(409);
        await opPage.unroute(conflictUrl);
        await opPage.getByRole("button",{name:"I reviewed the refreshed order",exact:true}).click();
        await action(opPage,id,"Resume work",reason);
        await complete(opPage,id,"PARTIAL");
        // Reporter cannot independently verify their own report.
        expect((await operator.request.post(`${apiBase}/api/v1/work-orders/${id}/commands`,{headers:{"Idempotency-Key":randomUUID()},data:{command:"CLOSE",expected_revision:(await read(id)).revision,verification:{result:"VERIFIED",note:"Negative self-verification test"}}})).status()).toBe(403);
        await action(managerPage,id,"Request rework",reason);
        await complete(opPage,id,"STOPPED");
        expect((await admin.request.patch(`${apiBase}/api/v1/users/${op.id}`,{data:{active:false}})).status()).toBe(200);
        expect((await admin.request.post(`${apiBase}/api/v1/work-orders/${id}/commands`,{headers:{"Idempotency-Key":randomUUID()},data:{command:"REQUEST_REWORK",expected_revision:(await read(id)).revision,reason:"Revoked assignee cannot resume"}})).status()).toBe(409);
        await action(managerPage,id,"Reassign for rework",assign("maintenance_e2e_engineer",true));
        await action(engineerPage,id,"Accept work");
        await expect.poll(async()=> (await read(id)).status).toBe("ACCEPTED");
        await action(engineerPage,id,"Start work");
        await expect.poll(async()=> (await read(id)).status).toBe("IN_PROGRESS");
        expect((await read(id)).actual_started_at).toBe(started);
        await complete(engineerPage,id,"SUCCESS");
        const ownClose=await engineer.request.post(`${apiBase}/api/v1/work-orders/${id}/commands`,{headers:{"Idempotency-Key":randomUUID()},data:{command:"CLOSE",expected_revision:(await read(id)).revision,verification:{result:"VERIFIED",note:"Negative independent verification test"}}});
        expect(ownClose.status()).toBe(403); expect(record((await json(ownClose)).error).code).toBe("SELF_VERIFICATION");
      } else {
        await action(opPage,id,"Accept work");
        await expect.poll(async()=> (await read(id)).status).toBe("ACCEPTED");
        await action(opPage,id,"Start work");
        await expect.poll(async()=> (await read(id)).status).toBe("IN_PROGRESS");
        await complete(opPage,id,outcome);
      }
      await captureWorkOrders(outcome === "SUCCESS" ? engineerPage : opPage, `lifecycle-${outcome.toLowerCase()}-completion`);
      if(outcome === "SUCCESS") {
        const url = `${apiBase}/api/v1/work-orders/${id}/commands`;
        await managerPage.route(url,async route=>{
          const response=await route.fetch(); expect(response.status()).toBe(200);
          submissions.push({key:route.request().headers()["idempotency-key"],body:route.request().postData()});
          if(submissions.length===1) await route.abort("failed");
          else {expect(response.headers()["idempotency-replayed"]).toBe("true"); await route.fulfill({response});}
        });
        await open(managerPage,id);
        await managerPage.getByRole("button",{name:"Verify and close",exact:true}).click();
        await managerPage.getByRole("dialog").getByLabel("Verification note",{exact:true}).fill("Independent final inspection");
        await managerPage.getByRole("dialog").getByRole("button",{name:"Confirm verify and close",exact:true}).click();
        await managerPage.getByRole("button",{name:"Retry original intent",exact:true}).click();
        await expect.poll(async()=>submissions.length).toBe(2); expect(submissions[1]).toEqual(submissions[0]);
        await managerPage.unroute(url);
      } else await action(managerPage,id,"Verify and close",async dialog=>{await dialog.getByLabel("Verification note",{exact:true}).fill("Independent inspection of actual outcome");});
      await expect.poll(async()=> (await read(id)).status).toBe("CLOSED");
      await open(managerPage,id);
      await captureWorkOrders(managerPage,`lifecycle-${outcome.toLowerCase()}-closed`);
      const persisted = array(await databaseQuery("SELECT status, attempt, verification_json FROM work_orders WHERE id=$1::uuid",id)).map(record)[0];
      expect(persisted.status).toBe("CLOSED");
      expect(record(persisted.verification_json).result).toBe(outcome === "STOPPED" ? "VERIFIED_STOPPED" : "VERIFIED");
      expect(persisted.attempt).toBe(outcome === "SUCCESS" ? 3 : 1);
      expect(await publicationState()).toEqual(publicationBeforeCommands);
      orders.push({id,outcome,recovery:outcome === "SUCCESS"});
    }
    // All publications came from the real planner/worker; Work Order commands never republish.
    const revokedUsers=array(await databaseQuery("SELECT id::text,role,active FROM users WHERE id IN ($1::uuid,$2::uuid)",op.id,other.id)).map(record);
    expect(revokedUsers.find(u=>u.id===op.id)?.active).toBe(false);
    expect(revokedUsers.find(u=>u.id===other.id)?.role).toBe("VIEWER");
    await writeFile(path.join(path.dirname(evidenceFile),"maintenance-lifecycle.json"),JSON.stringify({git_sha:required("OPERATIONS_E2E_GIT_SHA"),orders,real_picker:true,exact_origin:true,independent_close:true,partial_stopped:true,rework:true,revoked_in_progress_recovery:true,revoked_completed_recovery:true,command_same_key_body_replay:true,stale_ui_conflict:true,publication_unchanged_by_commands:true,completed_at:new Date().toISOString()},null,2));
  } finally { await Promise.all([admin,operator,replacement,engineer].map(context=>context.close())); }
});
