import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";

import { OperationsApiError, type OperationsCreateDecisionCaseRequest, type OperationsDecisionCommand } from "../../lib/operations-api/client";
import { createMockOperationsApiClient } from "../../lib/operations-api/mock";

const factoryId = "factory-demo-01";

async function backendContractHarness(page: Page) {
  const api = createMockOperationsApiClient();
  const writes: { key: string; body: OperationsDecisionCommand }[] = [];
  const options = { stale: false, pending: false, error: false, loseResponse: false, loseCreateResponse: false };
  const creates: { key: string; body: OperationsCreateDecisionCaseRequest }[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const segments = url.pathname.split("/");
    if (url.pathname.endsWith("/auth/me")) {
      await route.fulfill({ json: { success: true, user: { id: "preview-operator", role: "ENGINEER", fullName: "Operations Engineer" } } });
      return;
    }
    try {
      let data: unknown;
      let meta: unknown;
      if (url.pathname.endsWith("/operations/snapshot")) data = await api.getOperationsSnapshot(factoryId);
      else if (url.pathname.endsWith("/schedules/current")) data = await api.getCurrentSchedule(factoryId);
      else if (request.method() === "POST" && url.pathname.endsWith("/decision-cases")) {
        const body = request.postDataJSON() as OperationsCreateDecisionCaseRequest;
        const key = request.headers()["idempotency-key"];
        creates.push({ key, body });
        const response = await api.createDecisionCase(body, { idempotencyKey: key });
        if (options.loseCreateResponse) { options.loseCreateResponse = false; await route.abort("failed"); return; }
        data = response.caseStatus; meta = response.meta;
      } else if (request.method() === "POST" && url.pathname.endsWith("/decision")) {
        const body = request.postDataJSON() as OperationsDecisionCommand;
        const key = request.headers()["idempotency-key"];
        writes.push({ key, body });
        if (options.pending) return;
        if (options.error) throw new OperationsApiError(503, { success: false, error: { code: "DB_UNAVAILABLE", message: "Decision service is temporarily unavailable" } });
        const response = await api.submitDecisionCommand(segments[4], body, { idempotencyKey: key });
        if (options.loseResponse) { options.loseResponse = false; await route.abort("failed"); return; }
        data = response.caseStatus; meta = response.meta;
      } else if (url.pathname.endsWith("/recommendation")) data = await api.getDecisionCaseRecommendation(segments[4]);
      else if (segments[3] === "decision-cases") {
        const response = await api.getDecisionCase(segments[4]);
        if (options.stale) {
          response.meta!.stale = true;
          response.meta!.current_context = { snapshot_id: "snapshot-new-observation", plan_version: 2 };
          response.meta!.available_commands = [];
        }
        data = response.caseStatus; meta = response.meta;
      } else { await route.fulfill({ status: 404, json: { success: false } }); return; }
      await route.fulfill({ json: { success: true, data, ...(meta ? { meta } : {}) } });
    } catch (error: unknown) {
      if (!(error instanceof OperationsApiError)) throw error;
      await route.fulfill({ status: error.status, json: error.payload });
    }
  });
  return { api, writes, creates, options };
}

async function createThroughOverview(page: Page) {
  await page.goto("/operations");
  await expect(page.getByLabel("Planning reason")).toBeVisible();
  await page.getByLabel("Planning reason").fill("Review production and maintenance alternatives");
  await page.getByRole("button", { name: "Create case", exact: true }).click();
  await expect(page).toHaveURL(/recommendations\?caseId=/);
  await expect(page.getByRole("heading", { name: "Candidate comparison" })).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string, target: string) {
  if (target.startsWith("Confirm ")) await page.getByRole("heading", { name: target, exact: true }).scrollIntoViewIfNeeded();
  else {
    await page.getByRole("heading", { name: target, exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -80));
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (!process.env.OPERATIONS_CAPTURE_SCREENSHOTS) return;
  const directory = path.resolve("../docs/screenshots/live-decision-commit-workflow");
  await mkdir(directory, { recursive: true });
  // Exclude the Next development toolbar; production has no such badge.
  const devToolbarStyle = await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const screenshotPath = path.join(directory, `${name}-${info.project.name}.png`);
  if (name === "error") {
    await page.getByRole("heading", { name: target, exact: true }).locator("..").locator("..").screenshot({ path: screenshotPath, animations: "disabled" });
  } else await page.screenshot({ path: screenshotPath, fullPage: false, animations: "disabled" });
  await devToolbarStyle.evaluate(element => element.parentNode?.removeChild(element));
}

test("create → select → approve → commit → published Gantt; reload never writes", async ({ page }, info) => {
  const harness = await backendContractHarness(page);
  await createThroughOverview(page);
  await page.getByRole("button", { name: /RELIABILITY PRIORITY/ }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("VALID");
  await page.getByRole("button", { name: "Confirm approve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled();
  expect(harness.writes).toHaveLength(1);
  expect(harness.writes[0].body).toMatchObject({ command: "APPROVE", candidate_plan_id: "plan-reliability-priority" });
  await page.reload();
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled();
  expect(harness.writes).toHaveLength(1);
  await page.getByRole("button", { name: "Commit approved schedule" }).click();
  await expect(page.getByRole("dialog")).toContainText("plan-reliability-priority");
  await page.getByRole("button", { name: "Confirm commit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  await expect(page.getByText(/Published plan version 2/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current committed schedule", exact: true })).toBeVisible();
  await capture(page, info, "success", "Published schedule");
  await capture(page, info, "published-gantt", "Current committed schedule");
  const committed = await harness.api.getCurrentSchedule(factoryId);
  expect(committed.schedule?.schedule_id).toContain("reliability-priority");
  expect(harness.writes[0].key).not.toBe(harness.writes[1].key);
  await page.reload();
  await expect(page.getByText(/Published plan version 2/)).toBeVisible();
  expect(harness.writes).toHaveLength(2);
  await page.getByRole("link", { name: "Open current Gantt" }).click();
  await expect(page).toHaveURL(/\/operations\/schedule$/);
  await expect(page.getByRole("heading", { name: "Current committed schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Schedule context" }).getByText(committed.schedule!.schedule_id, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(/\/operations$/);
  await expect(page.getByRole("region", { name: "Snapshot context" }).getByText(committed.schedule!.schedule_id, { exact: true })).toBeVisible();
  expect(harness.writes).toHaveLength(2);
});

test("pending confirmation disables duplicate commands", async ({ page }, info) => {
  const harness = await backendContractHarness(page);
  await createThroughOverview(page);
  harness.options.pending = true;
  const decisionPosted = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/decision"));
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm approve", exact: true }).dblclick();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Submitting…" })).toBeDisabled();
  await decisionPosted;
  await expect.poll(() => harness.writes.length).toBe(1);
  await capture(page, info, "pending", "Confirm approve");
  // The command remains pending during capture, allowing duplicate POSTs to be observed.
  expect(harness.writes).toHaveLength(1);
});

test("stale basis fails closed and requires a new case", async ({ page }, info) => {
  const harness = await backendContractHarness(page);
  await createThroughOverview(page);
  harness.options.stale = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Case basis is stale", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeDisabled();
  await capture(page, info, "stale", "Case basis is stale");
  expect(harness.writes).toHaveLength(0);
});

test("service error retains the request without fixture fallback or fake success", async ({ page }, info) => {
  const harness = await backendContractHarness(page);
  await createThroughOverview(page);
  harness.options.error = true;
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm approve", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recover decision outcome" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Published schedule", exact: true })).toHaveCount(0);
  await expect(page.getByText("fixture preview", { exact: false })).toHaveCount(0);
  await capture(page, info, "error", "Human decision and publication");
  expect(harness.writes).toHaveLength(1);
});

test("lost approval response survives reload and manually recovers the original receipt", async ({ page }) => {
  const harness = await backendContractHarness(page);
  await createThroughOverview(page);
  harness.options.loseResponse = true;
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm approve", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recover decision outcome" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Recover decision outcome" })).toBeVisible();
  expect(harness.writes).toHaveLength(1);
  await page.getByRole("button", { name: "Recover decision outcome" }).click();
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled();
  expect(harness.writes).toHaveLength(2);
  expect(harness.writes[1]).toEqual(harness.writes[0]);
});

test("lost create response recovers the original case ID after reload", async ({ page }) => {
  const harness = await backendContractHarness(page);
  harness.options.loseCreateResponse = true;
  await page.goto("/operations");
  await page.getByLabel("Planning reason").fill("Recover original planning case");
  await page.getByRole("button", { name: "Create case", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recover create outcome" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Recover create outcome" })).toBeVisible();
  expect(harness.creates).toHaveLength(1);
  await page.getByRole("button", { name: "Recover create outcome" }).click();
  await expect(page.getByRole("heading", { name: "Candidate comparison", exact: true })).toBeVisible();
  expect(harness.creates).toHaveLength(2);
  expect(harness.creates[1]).toEqual(harness.creates[0]);
});
