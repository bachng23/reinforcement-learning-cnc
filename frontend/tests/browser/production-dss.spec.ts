import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createMockOperationsApiClient } from "../../lib/operations-api/mock";
import { OperationsApiError, type OperationsCreateDecisionCaseRequest, type OperationsDecisionCommand } from "../../lib/operations-api/client";

const factory = "factory-demo-01";
// Transport contract harness only. Real services are separately exercised in e2e/.
async function contractHarness(page: Page) {
  const api = createMockOperationsApiClient();
  const snapshot = await api.getOperationsSnapshot(factory);
  const options = { failure: false, viewer: false };
  const writes: unknown[] = [];
  const creates: unknown[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split("/")[4];
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: { success: true, user: { id: "preview-operator", role: options.viewer ? "VIEWER" : "ENGINEER", fullName: "Desktop contract harness" } } });
    try {
      let data: unknown;
      let meta: unknown;
      if (url.pathname.endsWith("/operations/overview")) {
        if (options.failure) return route.fulfill({ status: 503, json: { schema_version: "3.0", error_id: "overview-unavailable", code: "OPERATIONS_VALIDATOR_UNAVAILABLE", message: "Snapshot validation service unavailable", correlation_id: "desktop-contract-read", retryable: true, details: [] } });
        data = await api.getOperationsOverview(url.searchParams.get("factory_id")!);
      } else if (url.pathname.endsWith("/operations/snapshot")) data = await api.getOperationsSnapshot(url.searchParams.get("factory_id")!);
      else if (url.pathname.endsWith("/schedules/current")) data = await api.getCurrentSchedule(url.searchParams.get("factory_id")!);
      else if (request.method() === "POST" && url.pathname.endsWith("/decision-cases")) {
        const body = request.postDataJSON() as OperationsCreateDecisionCaseRequest;
        creates.push(body);
        const response = await api.createDecisionCase(body, { idempotencyKey: request.headers()["idempotency-key"] });
        data = response.caseStatus; meta = response.meta;
      } else if (request.method() === "POST" && url.pathname.endsWith("/decision")) {
        const body = request.postDataJSON() as OperationsDecisionCommand;
        writes.push(body);
        const response = await api.submitDecisionCommand(id, body, { idempotencyKey: request.headers()["idempotency-key"] });
        data = response.caseStatus; meta = response.meta;
      } else if (url.pathname.endsWith("/decision-cases")) {
        const response = await api.listDecisionCases({ factory_id: url.searchParams.get("factory_id")!,
          status: url.searchParams.get("status") as Parameters<typeof api.listDecisionCases>[0]["status"] ?? undefined,
          mode: url.searchParams.get("mode") as Parameters<typeof api.listDecisionCases>[0]["mode"] ?? undefined,
          cursor: url.searchParams.get("cursor") ?? undefined });
        data = response.data; meta = response.meta;
      } else if (url.pathname.endsWith("/recommendation")) data = await api.getDecisionCaseRecommendation(id);
      else if (url.pathname.endsWith("/events")) {
        const response = await api.listEvents(id, Number(url.searchParams.get("after_sequence") ?? 0), { limit: 1 });
        data = response.data; meta = response.meta;
      } else if (id) { const response = await api.getDecisionCase(id); data = response.caseStatus; meta = response.meta; }
      else return route.fulfill({ status: 404 });
      await route.fulfill({ json: { success: true, data, ...(meta ? { meta } : {}) } });
    } catch (error: unknown) {
      if (!(error instanceof OperationsApiError)) throw error;
      await route.fulfill({ status: error.status, json: error.payload });
    }
  });
  return { api, snapshot, options, writes, creates };
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (!process.env.DSS_CAPTURE_SCREENSHOTS) return;
  const directory = path.resolve("../docs/screenshots/production-dss/contract-harness");
  await mkdir(directory, { recursive: true });
  const style = await page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
  await page.screenshot({ path: path.join(directory, `${name}-${info.project.name}.png`), animations: "disabled" });
  await style.evaluate(element => element.parentNode?.removeChild(element));
}

test("production Overview → create → inspect → approve → exact published plan; scoped reads never write", async ({ page }, info) => {
  const harness = await contractHarness(page);
  await page.goto(`/overview?factory_id=${factory}`);
  await expect(page.getByRole("heading", { name: "Factory Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose machine" })).toBeVisible();
  await capture(page, info, "overview-empty-review");
  const trigger = page.getByRole("button", { name: "Choose machine" });
  await trigger.click();
  await expect(page.getByRole("combobox", { name: "Search machines" })).toBeFocused();
  await capture(page, info, "picker-open");
  await page.getByRole("combobox", { name: "Search machines" }).fill("M03");
  await page.getByRole("combobox", { name: "Search machines" }).press("Enter");
  await expect(page.getByRole("region", { name: "Selected machine detail" })).toContainText("source");
  await page.getByRole("region", { name: "Selected machine detail" }).scrollIntoViewIfNeeded();
  await capture(page, info, "machine-detail");
  await page.getByRole("link", { name: "Browse factory cases" }).click();
  await expect(page).toHaveURL(new RegExp(`/operations/cases\\?factory_id=${factory}`));
  await expect(page.getByText("No matching cases", { exact: true })).toBeVisible();
  expect(harness.creates).toHaveLength(0);
  expect(harness.writes).toHaveLength(0);
  await page.getByRole("link", { name: "Create a case from Overview" }).click();
  await page.getByLabel("Planning reason").fill("Review desktop production context");
  await page.getByRole("button", { name: "Create case", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Candidate comparison" })).toBeVisible();
  const caseId = new URL(page.url()).searchParams.get("caseId")!;
  expect(new URL(page.url()).searchParams.get("factory_id")).toBe(factory);
  await page.getByRole("link", { name: "Decision Cases", exact: true }).click();
  await expect(page.getByRole("link", { name: `Open recommendation for ${caseId}` })).toBeVisible();
  await capture(page, info, "case-list");
  await page.getByRole("link", { name: `Open recommendation for ${caseId}` }).click();
  await page.getByRole("heading", { name: "Candidate comparison" }).evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -80));
  await capture(page, info, "candidate-comparison");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm approve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled();
  await page.getByRole("button", { name: "Commit approved schedule" }).click();
  await expect(page.getByRole("dialog")).toContainText(factory);
  await capture(page, info, "commit-confirmation");
  await page.getByRole("button", { name: "Confirm commit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open this published Gantt" }).click();
  await expect(page).toHaveURL(new RegExp(`/operations/schedule\\?factory_id=${factory}&caseId=${caseId}`));
  await expect(page.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  await capture(page, info, "published-plan");
  await page.getByRole("heading", { name: "Published plan 2", exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -80));
  await capture(page, info, "published-lanes");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Published schedule", exact: true })).toBeVisible();
  expect(harness.creates).toHaveLength(1);
  expect(harness.writes).toHaveLength(2);
  await page.getByRole("link", { name: "Open refreshed Overview" }).click();
  await expect(page.getByRole("region", { name: "Published factory plan" })).toContainText("Head plan version 2");
  await capture(page, info, "overview-published");
});

test("service error is not demo, retry is read-only, VIEWER cannot create", async ({ page }, info) => {
  const harness = await contractHarness(page);
  harness.options.failure = true;
  harness.options.viewer = true;
  await page.goto(`/overview?factory_id=${factory}`);
  await expect(page.getByRole("heading", { name: "Factory overview could not be loaded" })).toBeVisible();
  await capture(page, info, "overview-error");
  expect(await page.getByRole("link", { name: "LIVE cases awaiting approval" }).count()).toBe(0);
  harness.options.failure = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Planning access" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create case", exact: true })).toHaveCount(0);
  expect(harness.creates).toHaveLength(0);
  expect(harness.writes).toHaveLength(0);
});
