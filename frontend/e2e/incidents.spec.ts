import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
const api = process.env.OPERATIONS_E2E_API_URL!;
const web = process.env.OPERATIONS_E2E_WEB_URL!;
const factory = process.env.INCIDENT_E2E_FACTORY_ID ?? process.env.OPERATIONS_E2E_FACTORY_ID!;
const artifact = path.dirname(process.env.OPERATIONS_E2E_EVIDENCE_FILE!);
const requireBackend = createRequire(path.resolve("../backend/package.json"));
test.use({ actionTimeout: 15_000 });
async function database(sql: string, ...args: unknown[]) {
  const url = new URL(process.env.OPERATIONS_E2E_DATABASE_URL!);
  if (!/_(test|ci)$/.test(url.pathname) || !/^product_api_it_browser_/.test(url.searchParams.get("schema") ?? "")) throw Error("Not an isolated browser schema");
  const { PrismaClient } = requireBackend("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try { return await db.$queryRawUnsafe(sql, ...args); } finally { await db.$disconnect(); }
}
async function context(browser: Browser, username: string, password: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  expect((await ctx.request.post(api + "/api/v1/auth/login", { data: { username, password } })).status()).toBe(200);
  return ctx;
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Review action", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm action", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
}
async function command(page: Page, name: string, fields: Record<string, string> = {}, expected = 200) {
  await page.getByLabel("Next action", { exact: true }).selectOption(name);
  for (const [label, value] of Object.entries(fields)) {
    const field = page.getByLabel(label, { exact: true });
    if (await field.evaluate(element => element.tagName) === "SELECT") await field.selectOption(value);
    else await field.fill(value);
  }
  const response = page.waitForResponse(r => r.url().includes("/incidents/") && r.url().endsWith("/commands") && r.request().method() === "POST");
  await confirm(page);
  const result = await response;
  expect(result.status()).toBe(expected);
  if (expected === 200) await expect(page.getByRole("button", { name: "Review action", exact: true })).toBeEnabled();
  return result.json();
}
async function post(ctx: BrowserContext, route: string, body: unknown, status = 200) {
  const response = await ctx.request.post(api + "/api/v1" + route, { headers: { "Idempotency-Key": randomUUID() }, data: body });
  const payload = await response.json();
  expect({ status: response.status(), error: payload.error }).toEqual({ status, error: undefined });
  return payload;
}
async function realPublication(ctx: BrowserContext) {
  const [head] = await database("SELECT * FROM operations_heads WHERE factory_id=$1", factory);
  const created = await post(ctx, "/decision-cases", {
    schema_version: "3.0", factory_id: factory, expected_snapshot_id: head.snapshot_id, expected_plan_version: head.plan_version,
    request: { mode: "LIVE", trigger: { type: "HEALTH_ALERT", machine_id: "M03", failure_probability: 0.42, alert_threshold: 0.3 },
      planning_config: { horizon_minutes: 720, candidate_limit: 3, solver_timeout_seconds: 30, simulation_runs: 100, base_seed: 20260922 } },
  }, 202);
  const id = created.data.decision_case_id;
  await expect.poll(async () => (await (await ctx.request.get(api + "/api/v1/decision-cases/" + id)).json()).data.status,
    { timeout: 90000 }).toBe("AWAITING_APPROVAL");
  const status = await (await ctx.request.get(api + "/api/v1/decision-cases/" + id)).json();
  const recommendation = (await (await ctx.request.get(api + "/api/v1/decision-cases/" + id + "/recommendation")).json()).data.recommendation;
  const [stored] = await database(`SELECT c.request_json, c.created_at, c.actor_id, s.payload_json
    FROM decision_cases c JOIN factory_snapshots s ON s.factory_id=c.factory_id AND s.snapshot_id=c.snapshot_id
    WHERE c.id=$1::uuid`, id);
  const replayRequest = {
    schema_version: "3.0", decision_case_id: id, mode: stored.request_json.request.mode,
    factory_snapshot: stored.payload_json, requested_by_user_id: stored.actor_id,
    trigger: { ...stored.request_json.request.trigger, event_id: id, occurred_at: stored.created_at.toISOString() },
    planning_config: stored.request_json.request.planning_config,
  };
  for (let replay = 0; replay < 2; replay++) {
    const response = await ctx.request.post(process.env.OPERATIONS_E2E_AI_URL + "/v1/operations/plan", {
      headers: { "X-Request-Id": "incident-replay-" + id, "X-Correlation-Id": id }, data: replayRequest,
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(recommendation);
  }
  expect(recommendation.candidate_plans.length).toBeGreaterThanOrEqual(1);
  expect(recommendation.candidate_plans.length).toBeLessThanOrEqual(3);
  const candidate = recommendation.candidate_plans.find((c: { candidate_plan_id: string }) => c.candidate_plan_id === recommendation.recommended_plan_id);
  expect(candidate).toBeTruthy();
  const identity = { schema_version: "3.0", decision_case_id: id, recommendation_id: recommendation.recommendation_id,
    candidate_plan_id: candidate.candidate_plan_id, candidate_version: candidate.plan_version,
    expected_snapshot_id: status.data.snapshot_id, expected_plan_version: status.meta.base_plan_version };
  const approved = await post(ctx, "/decision-cases/" + id + "/decision", { ...identity, command: "APPROVE", expected_case_revision: status.meta.case_revision });
  const committed = await post(ctx, "/decision-cases/" + id + "/decision", { ...identity, command: "COMMIT", expected_case_revision: approved.meta.case_revision });
  expect(committed.data.status).toBe("COMMITTED");
  const [publication] = await database("SELECT * FROM decision_commits WHERE case_id=$1::uuid", id);
  const [current] = await database("SELECT * FROM operations_heads WHERE factory_id=$1", factory);
  const assignment = candidate.schedule.assignments.find((a: { assignment_type: string; status: string }) => a.assignment_type === "MAINTENANCE" && a.status !== "CANCELLED");
  expect(assignment).toBeTruthy();
  const order = await post(ctx, "/work-orders", {
    factory_id: factory, source: { decision_case_id: id, schedule_id: publication.schedule_id,
      schedule_revision: publication.schedule_revision, schedule_hash: publication.schedule_hash, assignment_id: assignment.assignment_id },
    expected_head: { snapshot_id: current.snapshot_id, plan_version: current.plan_version, revision: current.revision },
  }, 201);
  // Across resets case/schedule IDs differ, so Monte-Carlo risk estimates and
  // the recommended strategy may differ. Exact replay above compares the entire
  // package for identical inputs; this fingerprint compares all physical plans.
  const physicalPlans = recommendation.candidate_plans.map((plan: typeof candidate) => ({
    strategy: plan.strategy, plan_version: plan.plan_version, validation: plan.validation.verdict,
    assignments: plan.schedule.assignments.map((a: Record<string, unknown>) => Object.fromEntries(
      ["assignment_type", "machine_id", "job_id", "operation_id", "maintenance_request_id", "technician_ids", "start_at", "end_at", "status", "locked"].map(key => [key, a[key]]))),
  })).sort((left: { strategy: string }, right: { strategy: string }) => left.strategy.localeCompare(right.strategy));
  const fingerprint = createHash("sha256").update(JSON.stringify(physicalPlans)).digest("hex");
  return { caseId: id, order: order.data, fingerprint };
}
async function link(page: Page, type: string, id: string) {
  await page.getByLabel("Next action", { exact: true }).selectOption("LINK");
  await page.getByLabel("Target type", { exact: true }).selectOption(type);
  await page.getByLabel("Target ID", { exact: true }).fill(id);
  const pending = page.waitForResponse(r => r.url().endsWith("/links") && r.request().method() === "POST");
  await confirm(page);
  expect((await pending).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Review action", exact: true })).toBeEnabled();
}
test("real incident desktop lifecycle, lost-response reload, roles and immutable history", async ({ browser }) => {
  test.setTimeout(240_000);
  const seeded = JSON.parse(await readFile(process.env.OPERATIONS_E2E_USERS_FILE!, "utf8"));
  const users = { ...seeded, engineer: seeded.incidentEngineer, operator: seeded.incidentOperator };
  const contexts: BrowserContext[] = [];
  const passed: string[] = [];
  try {
    const manager = await context(browser, "admin", process.env.OPERATIONS_E2E_ADMIN_PASSWORD!); contexts.push(manager);
    const owner = await context(browser, users.engineer.username, process.env.OPERATIONS_E2E_ROLE_PASSWORD!); contexts.push(owner);
    const page = await manager.newPage();
    await page.goto(web + "/operations/incidents?factory_id=" + factory);
    await page.getByRole("button", { name: "Report incident", exact: true }).click();
    const title = "Browser incident " + randomUUID();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Description — your observation", { exact: true }).fill("Manual equipment inspection; not sensor-confirmed recovery.");
    await page.getByLabel("Official severity", { exact: true }).selectOption("WARNING");
    await page.screenshot({ path: path.join(artifact, "incident-report-form.png"), fullPage: true });
    const sent: { key: string | undefined; body: unknown }[] = [];
    await page.route("**/api/v1/incidents", async route => {
      if (route.request().method() !== "POST") return route.continue();
      sent.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
      const response = await route.fetch();
      if (sent.length === 1) { expect(response.status()).toBe(201); await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    await confirm(page);
    await expect(page.getByRole("button", { name: "Recover original request" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Report incident", exact: true }).click();
    await page.getByRole("button", { name: "Recover original request" }).click();
    await expect(page).toHaveURL(/\/operations\/incidents\/[0-9a-f-]+\?/);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(await database("SELECT count(*)::int AS count FROM factory_incidents WHERE title=$1", title)).toEqual([{ count: 1 }]);
    passed.push("lost_response_reload_same_key_body_single_incident");
    await command(page, "ASSIGN", { "Owner user ID — active OPERATOR or ENGINEER in this factory": users.engineer.id });
    const ownerPage = await owner.newPage();
    await ownerPage.goto(web + "/operations/incidents/" + id + "?factory_id=" + factory);
    await command(ownerPage, "ACKNOWLEDGE");
    await command(ownerPage, "START_INVESTIGATION");
    const before = await database("SELECT to_jsonb(h) AS head FROM operations_heads h WHERE factory_id=$1", factory);
    await command(ownerPage, "MARK_RESOLVED", {
      "Resolution summary": "Inspection complete", "Verification evidence — human report": "Human inspection report",
    });
    await expect(ownerPage.getByLabel("Next action").locator("option[value=CLOSE]")).toHaveCount(0);
    await page.reload();
    await command(page, "CLOSE", { "Independent verification note": "Separate manager checked the resolution" });
    await expect(page.getByText("CLOSED", { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("Separate manager checked the resolution", { exact: true }).first()).toBeVisible();
    await command(page, "REOPEN", { Reason: "Additional human observation requires another investigation" });
    await expect(page.getByText("OPEN", { exact: true }).first()).toBeVisible();
    expect(await database("SELECT to_jsonb(h) AS head FROM operations_heads h WHERE factory_id=$1", factory)).toEqual(before);
    const history = await database("SELECT sequence,command,actor_id FROM incident_events WHERE incident_id=$1::uuid ORDER BY sequence", id);
    expect(history.map((e: { command: string }) => e.command)).toEqual(["REPORT", "ASSIGN", "ACKNOWLEDGE", "START_INVESTIGATION", "MARK_RESOLVED", "CLOSE", "REOPEN"]);
    expect(history[4].actor_id).toBe(users.engineer.id);
    expect(history[5].actor_id).not.toBe(users.engineer.id);
    passed.push("ui_report_assign_ack_investigate_resolve_independent_close_reopen", "history_matches_postgresql", "lifecycle_does_not_change_schedule");
    const occurrenceSource = randomUUID();
    const appended = await command(page, "APPEND_OCCURRENCE", {
      "Existing source event ID (optional, for deduplication)": occurrenceSource, Reason: "New observation on the same incident",
    });
    expect(appended.data.incident.occurrence_count).toBe(2);
    const duplicate = await command(page, "APPEND_OCCURRENCE", {
      "Existing source event ID (optional, for deduplication)": occurrenceSource, Reason: "Explicit retry of observation",
    });
    expect(duplicate.data.incident.revision).toBe(appended.data.incident.revision);
    expect(duplicate.data.incident.occurrence_count).toBe(2);
    await command(page, "CHANGE_SEVERITY", { "Confirmed severity": "INFO", Reason: "Manager reviewed the observations" });
    await command(page, "REASSIGN", {
      "Owner user ID — active OPERATOR or ENGINEER in this factory": users.operator.id, Reason: "Transfer investigation ownership",
    });
    await ownerPage.reload();
    await expect(ownerPage.getByLabel("Next action").locator("option[value=ACKNOWLEDGE]")).toHaveCount(0);
    passed.push("ui_append_duplicate_noop", "ui_severity_confirmation", "ui_reassignment_revokes_old_owner_actions");
    // Hold the confirmation open while another authenticated context changes the
    // same Incident. The original browser request must retain its old revision.
    await page.getByLabel("Next action", { exact: true }).selectOption("CHANGE_SEVERITY");
    await page.getByLabel("Confirmed severity", { exact: true }).selectOption("WARNING");
    await page.getByLabel("Reason", { exact: true }).fill("Stale confirmation");
    await page.getByRole("button", { name: "Review action", exact: true }).click();
    const current = (await (await manager.request.get(api + "/api/v1/incidents/" + id)).json()).data.incident;
    await post(manager, "/incidents/" + id + "/commands", { command: "CHANGE_SEVERITY",
      expected_revision: current.revision, severity: "CRITICAL", reason: "Valid concurrent manager update" });
    const oldRequest = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Confirm action", exact: true }).click();
    const stale = await oldRequest;
    expect(stale.status()).toBe(409);
    expect(stale.request().postDataJSON().expected_revision).toBe(current.revision);
    expect((await stale.json()).error.code).toBe("INCIDENT_REVISION_CONFLICT");
    await expect(page.getByRole("button", { name: "Refresh and review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Recover original request" })).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh and review" }).click();
    await expect(page.getByText("CRITICAL", { exact: true }).first()).toBeVisible();
    expect((await database("SELECT count(*)::int AS count FROM incident_events WHERE incident_id=$1::uuid AND payload->>'reason'='Stale confirmation'", id))[0].count).toBe(0);
    passed.push("stale_ui_confirmation_keeps_original_revision_no_side_effect");
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: path.join(artifact, "incident-detail-" + width + ".png"), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    const viewer = await context(browser, users.viewer.username, process.env.OPERATIONS_E2E_ROLE_PASSWORD!); contexts.push(viewer);
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(web + "/operations/incidents/" + id + "?factory_id=" + factory);
    await expect(viewerPage.getByText("No action available for your role or this state.", { exact: false })).toBeVisible();
    const denied = await viewer.request.post(api + "/api/v1/incidents/" + id + "/commands", {
      headers: { "Idempotency-Key": randomUUID() }, data: { command: "CHANGE_SEVERITY", expected_revision: 7, severity: "INFO", reason: "not allowed" },
    });
    expect(denied.status()).toBe(403);
    const outsider = await context(browser, users.outsider.username, process.env.OPERATIONS_E2E_ROLE_PASSWORD!); contexts.push(outsider);
    expect((await outsider.request.get(api + "/api/v1/incidents/" + id)).status()).toBe(404);
    passed.push("read_only_role_and_server_rejection", "out_of_scope_hidden", "desktop_1280_1440_1920");
    await page.goto(web + "/operations/incidents?factory_id=" + factory);
    await page.getByLabel("Search title or description").fill(title);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/q=Browser/);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await page.screenshot({ path: path.join(artifact, "incident-list-search.png"), fullPage: true });
    passed.push("server_search_url_reload");
    // Full linked flow: planner and Work Order APIs are real; all Incident writes
    // remain browser UI actions. Never substitute a candidate fixture here.
    const planned = await realPublication(manager);
    await page.getByRole("button", { name: "Report incident", exact: true }).click();
    await page.getByLabel("Report source", { exact: true }).selectOption("case_health_alert");
    await page.getByLabel("Title", { exact: true }).fill("Linked maintenance incident");
    await page.getByLabel("Description — your observation", { exact: true }).fill("Investigate the immutable LIVE health alert.");
    await page.getByLabel("LIVE health-alert case ID", { exact: true }).fill(planned.caseId);
    await page.getByLabel("Official severity", { exact: true }).selectOption("WARNING");
    await confirm(page);
    await expect(page).toHaveURL(/\/operations\/incidents\/[0-9a-f-]+\?/);
    const linkedId = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(linkedId).not.toBe(id);
    await expect(page.getByText("Immutable LIVE health-alert case evidence")).toBeVisible();
    await command(page, "ASSIGN", { "Owner user ID — active OPERATOR or ENGINEER in this factory": users.engineer.id });
    await link(page, "case", planned.caseId);
    await link(page, "work_order", planned.order.id);
    await page.screenshot({ path: path.join(artifact, "incident-real-links.png"), fullPage: true });
    await ownerPage.goto(web + "/operations/incidents/" + linkedId + "?factory_id=" + factory);
    await command(ownerPage, "ACKNOWLEDGE");
    await command(ownerPage, "START_INVESTIGATION");
    const blocked = await command(ownerPage, "MARK_RESOLVED", { "Resolution summary": "Attempt before order completion", "Verification evidence — human report": "Not sufficient yet" }, 409);
    expect(blocked.error.code).toBe("INCIDENT_WORK_ORDER_ACTIVE");
    await ownerPage.getByRole("button", { name: "Refresh and review" }).click();
    let order = planned.order;
    const orderCommand = async (ctx: BrowserContext, cmd: string, fields = {}) => {
      order = (await post(ctx, "/work-orders/" + order.id + "/commands", { command: cmd, expected_revision: order.revision, ...fields })).data;
    };
    await orderCommand(manager, "ASSIGN", { assignee_user_id: users.engineer.id });
    await orderCommand(owner, "ACCEPT");
    await orderCommand(owner, "START");
    await orderCommand(owner, "BLOCK", { reason: "Awaiting inspection material" });
    await orderCommand(owner, "RESUME", { reason: "Material verified" });
    await orderCommand(owner, "COMPLETE", { report: { outcome: "SUCCESS", work_performed: "Manual maintenance report", result: "Pending independent verification" } });
    const stillBlocked = await command(ownerPage, "MARK_RESOLVED", { "Resolution summary": "Order is only COMPLETED", "Verification evidence — human report": "Awaiting order verifier" }, 409);
    expect(stillBlocked.error.code).toBe("INCIDENT_WORK_ORDER_ACTIVE");
    await ownerPage.getByRole("button", { name: "Refresh and review" }).click();
    await orderCommand(manager, "CLOSE", { verification: { result: "VERIFIED", note: "Independent work order verification" } });
    expect((await (await manager.request.get(api + "/api/v1/incidents/" + linkedId)).json()).data.incident.status).toBe("INVESTIGATING");
    const publishedBeforeResolution = await database("SELECT to_jsonb(h) AS head FROM operations_heads h WHERE factory_id=$1", factory);
    await command(ownerPage, "MARK_RESOLVED", { "Resolution summary": "Maintenance independently verified", "Verification evidence — human report": "Work order closed; human incident inspection complete" });
    await page.reload();
    await command(page, "CLOSE", { "Independent verification note": "Independent incident verification after maintenance" });
    await page.reload();
    await expect(page.getByText("CLOSED", { exact: true }).first()).toBeVisible();
    expect(await database("SELECT to_jsonb(h) AS head FROM operations_heads h WHERE factory_id=$1", factory)).toEqual(publishedBeforeResolution);
    expect((await database("SELECT status FROM work_orders WHERE id=$1::uuid", order.id))[0].status).toBe("CLOSED");
    const linkedDetail = (await (await manager.request.get(api + "/api/v1/incidents/" + linkedId)).json()).data;
    await link(page, "work_order", order.id);
    const afterDuplicate = (await (await manager.request.get(api + "/api/v1/incidents/" + linkedId)).json()).data;
    expect(afterDuplicate.incident.revision).toBe(linkedDetail.incident.revision);
    const caseLink = linkedDetail.links.find((l: { type: string }) => l.type === "case");
    await page.getByLabel("Next action", { exact: true }).selectOption("UNLINK");
    await page.getByLabel("Link to remove", { exact: true }).selectOption(caseLink.id);
    await page.getByLabel("Reason", { exact: true }).fill("Remove association while preserving trace");
    const unlinked = page.waitForResponse(r => r.url().includes("/links/") && r.request().method() === "DELETE");
    await confirm(page);
    expect((await unlinked).status()).toBe(200);
    expect((await database("SELECT removal_reason FROM incident_case_links WHERE id=$1::uuid", caseLink.id))[0].removal_reason).toBe("Remove association while preserving trace");
    passed.push("ui_duplicate_link_noop", "ui_unlink_preserves_trace");
    passed.push("exact_persisted_request_replay_matches_full_recommendation", "real_worker_fastapi_approve_commit_work_order", "from_case_ui_immutable_evidence", "real_case_and_work_order_links",
      "active_and_completed_orders_block_resolution", "order_close_does_not_auto_close_incident", "independent_linked_incident_closure");
    // Populate through the actual report form; counts must describe the entire
    // factory even when a cursor page displays only ten rows.
    for (let index = 0; index < 9; index++) {
      await page.goto(web + "/operations/incidents?factory_id=" + factory);
      await page.getByRole("button", { name: "Report incident", exact: true }).click();
      await page.getByLabel("Title", { exact: true }).fill("Pagination observation " + index);
      await page.getByLabel("Description — your observation", { exact: true }).fill("Independent human observation for navigation verification.");
      await confirm(page);
      await expect(page).toHaveURL(/\/operations\/incidents\/[0-9a-f-]+\?/);
    }
    await page.goto(web + "/operations/incidents?factory_id=" + factory);
    await page.getByLabel("Page size", { exact: true }).selectOption("10");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(10);
    const total = (await database("SELECT count(*)::int AS total FROM factory_incidents WHERE factory_id=$1", factory))[0].total;
    expect(total).toBeGreaterThan(10);
    await expect(page.getByRole("region", { name: "Full factory counts" }).getByText(String(total), { exact: true })).toBeVisible();
    const firstPage = await page.locator("tbody tr td:first-child a").allTextContents();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(page.locator("tbody tr")).toHaveCount(total - 10);
    const secondPage = await page.locator("tbody tr td:first-child a").allTextContents();
    expect(secondPage.every(text => !firstPage.includes(text))).toBe(true);
    await page.reload();
    await expect(page.locator("tbody tr td:first-child a")).toHaveText(secondPage);
    await page.goBack();
    await expect(page.locator("tbody tr td:first-child a")).toHaveText(firstPage);
    await page.getByLabel("Status", { exact: true }).selectOption("CLOSED");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/status=CLOSED/);
    await expect(page.getByRole("link", { name: "Linked maintenance incident", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(artifact, "incident-filtered-list.png"), fullPage: true });
    passed.push("ui_reports_count_exceeds_page", "cursor_disjoint_pages", "cursor_reload_and_browser_back", "server_status_filter");
    await writeFile(path.join(artifact, "incident-evidence.json"), JSON.stringify({
      git_sha: process.env.OPERATIONS_E2E_GIT_SHA, run: Number(process.env.OPERATIONS_E2E_RUN),
      source_tree_dirty: process.env.OPERATIONS_E2E_SOURCE_DIRTY !== "false",
      incident_id: id, assertions_passed: passed,
      linked_incident_id: linkedId, decision_case_id: planned.caseId, work_order_id: order.id,
      recommendation_fingerprint: planned.fingerprint,
      not_covered_by_this_suite: ["populated_exact_base_upgrade", "http_role_revocation_and_coordinated_lock_tests"],
    }, null, 2));
  } finally {
    for (const ctx of contexts.reverse()) await ctx.close().catch(error => {
      if (!/Target closed|Target page, context or browser has been closed|Failed to find context/.test(String(error))) throw error;
    });
  }
});
