import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createMockOperationsApiClient } from "../../lib/operations-api/mock";
import { OperationsApiError, type OperationsCreateDecisionCaseRequest, type OperationsDecisionCommand } from "../../lib/operations-api/client";

/** Browser contract suite, NOT a PostgreSQL/worker acceptance claim. */
async function readContractHarness(page: Page) {
  const api = createMockOperationsApiClient();
  const context = await api.getOperationsSnapshot("factory-demo-01");
  const body: OperationsCreateDecisionCaseRequest = { schema_version: "3.0", factory_id: context.factory_id,
    expected_snapshot_id: context.snapshot_id, expected_plan_version: context.plan_version,
    request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: "Contract harness" }, planning_config: { horizon_minutes: 720 } } };
  let committedId = "";
  for (let index = 0; index < 26; index++) {
    const created = await api.createDecisionCase({ ...body, request: { ...body.request, mode: index % 2 ? "SIMULATION_ONLY" : "LIVE" } }, { idempotencyKey: `seed-${index}` });
    await api.getDecisionCase(created.caseStatus.decision_case_id);
    if (!index) committedId = created.caseStatus.decision_case_id;
  }
  const ready = await api.getDecisionCase(committedId);
  const artifact = await api.getDecisionCaseRecommendation(committedId);
  const candidate = artifact.recommendation.candidate_plans[0];
  const approval: OperationsDecisionCommand = { schema_version: "3.0", decision_case_id: committedId, recommendation_id: artifact.recommendation.recommendation_id,
    expected_snapshot_id: context.snapshot_id, expected_plan_version: context.plan_version, expected_case_revision: ready.meta!.case_revision,
    command: "APPROVE", candidate_plan_id: candidate.candidate_plan_id, candidate_version: candidate.plan_version };
  const approved = await api.submitDecisionCommand(committedId, approval, { idempotencyKey: "seed-approve" });
  await api.submitDecisionCommand(committedId, { ...approval, command: "COMMIT", expected_case_revision: approved.meta!.case_revision }, { idempotencyKey: "seed-commit" });
  const options = { status: 0, network: false, pending: false };
  let release: () => void = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  const reads: URL[] = [];
  const writes: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const segments = url.pathname.split("/");
    if (url.pathname.endsWith("/auth/me")) {
      await route.fulfill({ json: { success: true, user: { id: "preview-operator", role: "ENGINEER", fullName: "Operations Engineer" } } }); return;
    }
    if (req.method() !== "GET") { writes.push(req.method()); await route.fulfill({ status: 405 }); return; }
    reads.push(url);
    if (options.pending) await hold;
    if (options.network) { await route.abort("failed"); return; }
    if (options.status) { await route.fulfill({ status: options.status, json: { success: false } }); return; }
    try {
      let data: unknown;
      let meta: unknown;
      if (url.pathname.endsWith("/decision-cases")) {
        const response = await api.listDecisionCases({ factory_id: url.searchParams.get("factory_id")!,
          status: url.searchParams.get("status") as Parameters<typeof api.listDecisionCases>[0]["status"] ?? undefined,
          mode: url.searchParams.get("mode") as Parameters<typeof api.listDecisionCases>[0]["mode"] ?? undefined,
          cursor: url.searchParams.get("cursor") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 25) });
        data = response.data; meta = response.meta;
      } else if (url.pathname.endsWith("/events")) {
        // Force several valid pages even when the client requests limit=100.
        const response = await api.listEvents(segments[4], Number(url.searchParams.get("after_sequence") ?? 0), { limit: 1 });
        data = response.data; meta = response.meta;
      } else if (url.pathname.endsWith("/recommendation")) data = await api.getDecisionCaseRecommendation(segments[4]);
      else if (segments[3] === "decision-cases") { const response = await api.getDecisionCase(segments[4]); data = response.caseStatus; meta = response.meta; }
      else if (url.pathname.endsWith("/operations/snapshot")) data = await api.getOperationsSnapshot(context.factory_id);
      else if (url.pathname.endsWith("/schedules/current")) data = await api.getCurrentSchedule(context.factory_id);
      else { await route.fulfill({ status: 404 }); return; }
      await route.fulfill({ json: { success: true, data, meta } });
    } catch (error: unknown) {
      if (!(error instanceof OperationsApiError)) throw error;
      await route.fulfill({ status: error.status, json: error.payload });
    }
  });
  return { options, release, reads, writes, committedId };
}

async function capture(page: Page, info: TestInfo, name: string, selector?: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (!process.env.OPERATIONS_CAPTURE_SCREENSHOTS) return;
  const directory = path.resolve("../docs/screenshots/decision-cases-audit");
  await mkdir(directory, { recursive: true });
  // Component crops exclude outside sticky chrome, which otherwise crosses
  // long element screenshots. Full-page state captures keep the normal header.
  const style = await page.addStyleTag({ content: `nextjs-portal { display: none !important; } ${selector ? "header.sticky { visibility: hidden !important; }" : ""}` });
  const screenshotPath = path.join(directory, `${name}-${info.project.name}.png`);
  if (selector) await page.locator(selector).screenshot({ path: screenshotPath, animations: "disabled" });
  else await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
  await style.evaluate(element => element.parentNode?.removeChild(element));
}

test("discover, filter, paginate, reopen, read complete audit, and reload/refresh without writes", async ({ page }, info) => {
  const harness = await readContractHarness(page);
  await page.goto("/operations");
  await page.getByRole("navigation", { name: "Operations screens" }).getByRole("link", { name: "Decision Cases" }).click();
  await expect(page.getByText("25 cases loaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more cases" }).click();
  await expect(page.getByText("26 cases loaded", { exact: true })).toBeVisible();
  expect(harness.reads.filter(url => url.pathname.endsWith("/decision-cases")).some(url => url.searchParams.has("cursor"))).toBe(true);
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("COMMITTED");
  await page.getByRole("combobox", { name: "Case mode", exact: true }).selectOption("LIVE");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("1 case loaded", { exact: true })).toBeVisible();
  await capture(page, info, "list-success", '[aria-label="Decision case results"]');
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("COMMITTED");
  await page.getByRole("link", { name: `Open recommendation for ${harness.committedId}` }).click();
  await expect(page).toHaveURL(new RegExp(`recommendations\\?.*caseId=${harness.committedId}`));
  const events = page.getByRole("list", { name: "Decision case audit events" });
  await expect(events.getByRole("listitem")).toHaveCount(4);
  await page.locator("#decision-case-audit").scrollIntoViewIfNeeded();
  await capture(page, info, "timeline-success", "#decision-case-audit");
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(page.getByText("4 events · 4 pages read · complete read")).toBeVisible();
  await expect(events.getByRole("listitem")).toHaveCount(4);
  await page.reload();
  await expect(events.getByRole("listitem")).toHaveCount(4);
  expect(harness.writes).toEqual([]);
});

test("missing case links to discovery, empty filters never manufacture cases", async ({ page }, info) => {
  await readContractHarness(page);
  await page.goto("/operations/recommendations");
  await page.getByRole("link", { name: "Browse decision cases" }).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("REJECTED");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("heading", { name: "No matching cases" })).toBeVisible();
  await capture(page, info, "empty");
});

test("loading, read errors, network retry and authorization discard rows", async ({ page }, info) => {
  const harness = await readContractHarness(page);
  harness.options.pending = true;
  await page.goto("/operations/cases");
  await expect(page.getByRole("heading", { name: "Loading decision cases" })).toBeVisible();
  await capture(page, info, "loading");
  harness.options.pending = false;
  harness.release();
  await expect(page.getByText("25 cases loaded", { exact: true })).toBeVisible();
  harness.options.network = true;
  await page.getByRole("button", { name: "Refresh cases" }).click();
  await expect(page.getByRole("heading", { name: "Cases could not be loaded" })).toBeVisible();
  await capture(page, info, "error");
  harness.options.network = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("25 cases loaded", { exact: true })).toBeVisible();
  harness.options.status = 403;
  await page.getByRole("button", { name: "Load more cases" }).click();
  await expect(page.getByRole("heading", { name: "Case access required" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await capture(page, info, "authorization");
  expect(harness.writes).toEqual([]);
});


test("browser Back restores applied case filters and performs no commands", async ({ page }) => {
  const harness = await readContractHarness(page);
  await page.goto("/operations/cases");
  await expect(page.getByText("25 cases loaded", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("COMMITTED");
  await page.getByRole("combobox", { name: "Case mode", exact: true }).selectOption("LIVE");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("1 case loaded", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: `Open recommendation for ${harness.committedId}` }).click();
  await expect(page.getByRole("list", { name: "Decision case audit events" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/status=COMMITTED/);
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("COMMITTED");
  await expect(page.getByRole("combobox", { name: "Case mode", exact: true })).toHaveValue("LIVE");
  await expect(page.getByText("1 case loaded", { exact: true })).toBeVisible();
  const lastListRead = harness.reads.filter(url => url.pathname.endsWith("/decision-cases")).at(-1)!;
  expect(lastListRead.searchParams.get("status")).toBe("COMMITTED");
  expect(lastListRead.searchParams.get("mode")).toBe("LIVE");
  expect(harness.writes).toEqual([]);
});


test("changed filters wait for the route before results and survive immediate reload", async ({ page }) => {
  const harness = await readContractHarness(page);
  await page.goto("/operations/cases");
  await expect(page.getByText("25 cases loaded", { exact: true })).toBeVisible();

  let releaseNavigation: () => void = () => {};
  const navigationGate = new Promise<void>(resolve => { releaseNavigation = resolve; });
  let navigationHeld = false;
  // Delay the RSC navigation, independently of the fast case-list API. This
  // makes the former local-query/URL race deterministic without a timed sleep.
  const navigationPattern = "**/operations/cases?**";
  await page.route(navigationPattern, async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("status") === "COMMITTED" && route.request().headers().rsc === "1") {
      navigationHeld = true;
      await navigationGate;
    }
    await route.continue();
  });
  try {
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("COMMITTED");
    await page.getByRole("combobox", { name: "Case mode", exact: true }).selectOption("LIVE");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect.poll(() => navigationHeld).toBe(true);
    expect(new URL(page.url()).searchParams.get("status")).toBeNull();
    await expect(page.getByRole("button", { name: "Applying filters…", exact: true })).toBeDisabled();
    expect(harness.reads.some(url => url.pathname.endsWith("/decision-cases") && url.searchParams.has("status"))).toBe(false);

    releaseNavigation();
    await expect(page).toHaveURL(/status=COMMITTED&mode=LIVE/);
    await expect(page.getByText("1 case loaded", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("COMMITTED");
    await expect(page.getByRole("combobox", { name: "Case mode", exact: true })).toHaveValue("LIVE");
    await expect(page.getByRole("article")).toHaveCount(1);
    const lastRead = harness.reads.filter(url => url.pathname.endsWith("/decision-cases")).at(-1)!;
    expect(lastRead.searchParams.get("status")).toBe("COMMITTED");
    expect(lastRead.searchParams.get("mode")).toBe("LIVE");
    expect(harness.writes).toEqual([]);
  } finally {
    releaseNavigation();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
