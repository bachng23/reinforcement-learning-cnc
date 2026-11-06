import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { eventExample, workOrderActor, workOrderExample, workOrderListExample } from "../work-order-fixtures";
import type { WorkOrderResponse, WorkOrderSummary } from "../../types/generated/work-orders";

// Contract isolation only: these static payloads are not a lifecycle emulator,
// eligible-user directory, production adapter, or API/PostgreSQL acceptance.
const factory = workOrderExample().data.factory_id;
const id = workOrderExample().data.id;
async function harness(page: Page) {
  const options = { detail: workOrderExample(), status: 200, empty: false, offline: false, viewer: false, command: "hold" as "hold" | "conflict" | "offline" };
  const writes: { body: unknown; key: string }[] = [];
  const reads: URL[] = [];
  const list = workOrderListExample();
  const rows: WorkOrderSummary[] = ["UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CLOSED", "CANCELLED"].map((status, index) => ({ ...list.data[0], id: index === 0 ? id : `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, status: status as WorkOrderSummary["status"], machine_id: `M0${index + 1}`, maintenance_request_id: `maintenance-request-${index + 1}`, waiting_verification: status === "COMPLETED", overdue: index === 4, assignee: index ? { user_id: workOrderActor.id, username: "maintenance.engineer", active: true } : null }));
  let release: (() => void) | undefined;
  await page.route("**/api/v1/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: { success: true, user: { ...workOrderActor, role: options.viewer ? "VIEWER" : workOrderActor.role } } });
    if (!url.pathname.includes("/work-orders")) return route.fulfill({ status: 404, json: { success: false, error: { code: "NOT_FOUND", message: "Not part of this contract harness" } } });
    if (request.method() === "POST") {
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (options.command === "hold") await new Promise<void>(resolve => { release = resolve; });
      if (options.command === "offline") return route.abort("connectionfailed");
      return route.fulfill({ status: 409, json: { success: false, error: { code: "WORK_ORDER_REVISION_CONFLICT", message: "Private database details must not be displayed" }, requestId: "contract-conflict" } });
    }
    reads.push(url);
    if (options.offline) return route.abort("connectionfailed");
    if (options.status !== 200) return route.fulfill({ status: options.status, json: { success: false, error: { code: options.status === 400 ? "INVALID_CURSOR" : "READ_UNAVAILABLE", message: "Private database details must not be displayed" }, requestId: `contract-read-${options.status}` } });
    if (url.pathname.endsWith("/eligible-assignees")) return route.fulfill({ json: {success: true, data: [], meta: {read_at: list.meta.read_at, timezone: "UTC", has_more: false, next_after: null}} });
    if (url.pathname.endsWith("/events")) {
      const after = Number(url.searchParams.get("after_sequence") ?? 0);
      const event = eventExample(after + 1);
      if (after === 1) { event.payload.attempt = 1; event.payload.report = { outcome: "STOPPED", work_performed: "Inspected spindle and isolated the worn bearing.", result: "Replacement part unavailable; work safely stopped.", stop_reason: "Awaiting replacement bearing" }; }
      if (after === 2) { event.command = "REQUEST_REWORK"; event.payload.attempt = 2; event.payload.from_status = "COMPLETED"; event.payload.to_status = "IN_PROGRESS"; event.payload.reason = "Independent review requests an additional inspection"; delete event.payload.report; }
      return route.fulfill({ json: { success: true, data: [event], meta: { read_at: list.meta.read_at, timezone: "UTC", limit: 1, has_more: after < 2, next_after_sequence: after + 1 } } });
    }
    if (url.pathname.endsWith("/work-orders")) {
      const matching = rows.filter(row => (!url.searchParams.get("status") || row.status === url.searchParams.get("status")) && (!url.searchParams.get("machine_id") || row.machine_id === url.searchParams.get("machine_id")) && (!url.searchParams.get("assignee_user_id") || row.assignee?.user_id === url.searchParams.get("assignee_user_id")) && (!url.searchParams.get("overdue") || row.overdue === (url.searchParams.get("overdue") === "true")));
      const pageRows = options.empty ? [] : url.searchParams.has("cursor") ? matching.slice(4) : matching.slice(0, 4);
      const more = !options.empty && !url.searchParams.has("cursor") && matching.length > 4;
      return route.fulfill({ json: { ...list, data: pageRows, meta: { ...list.meta, has_more: more, next_cursor: more ? "opaque:next/+=" : null } } });
    }
    return route.fulfill({ json: options.detail });
  });
  return { options, writes, reads, release: () => release?.() };
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (!process.env.WORK_ORDERS_CAPTURE) return;
  const directory = path.resolve("../docs/screenshots/maintenance-workspace/contract-harness"); await mkdir(directory, { recursive: true });
  const style = await page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
  await page.screenshot({ path: path.join(directory, `${name}-${info.project.name}.png`), animations: "disabled" });
  await style.evaluate(element => element.parentNode?.removeChild(element));
}

test("desktop list filters commit to URL, opaque cursor/back and exact detail return are read-only", async ({ page }, info) => {
  const api = await harness(page);
  await page.goto(`/operations/work-orders?factory_id=${factory}`);
  await expect(page.getByRole("heading", { name: "Work Orders", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Work Order results" })).toContainText("4 orders displayed");
  await capture(page, info, "list");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("cursor")).toBe("opaque:next/+=");
  await expect(page.getByRole("region", { name: "Work Order results" })).toContainText("3 orders displayed");
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("cursor")).toBe(false);
  await page.getByLabel("Machine ID", { exact: true }).fill("M01");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("machine_id")).toBe("M01");
  await page.getByRole("link", { name: `Open work order ${id}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/operations/work-orders/${id}\\?`));
  await expect(page.getByRole("heading", { name: "Work requirements and execution context" })).toBeVisible();
  await page.getByRole("link", { name: "Back to filtered work orders" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("machine_id")).toBe("M01");
  await expect(page.getByLabel("Machine ID", { exact: true })).toHaveValue("M01");
  expect(api.writes).toHaveLength(0);
  expect(api.reads.filter(url => !url.pathname.endsWith("/events") && !url.pathname.endsWith("/eligible-assignees") && url.pathname !== "/api/v1/work-orders" && !url.pathname.endsWith(`/${id}`))).toHaveLength(0);
});

test("historical detail keeps paged old reports, exact provenance and independent verification modal", async ({ page }, info) => {
  const api = await harness(page); const detail: WorkOrderResponse = api.options.detail;
  detail.data.status = "COMPLETED"; detail.data.waiting_verification = true; detail.data.available_commands = ["CLOSE", "REQUEST_REWORK", "REASSIGN_FOR_REWORK"];
  detail.data.source_is_current = false; detail.data.machine_in_current_snapshot = false;
  detail.data.latest_completion = { actor_id: "b0000000-0000-4000-8000-000000000002", attempt: 2, completed_at: detail.meta.read_at, report: { outcome: "STOPPED", work_performed: "Inspected and isolated the damaged component.", result: "Maintenance was stopped pending a replacement part.", stop_reason: "Required bearing unavailable" } };
  await page.goto(`/operations/work-orders/${id}?factory_id=${factory}`);
  await expect(page.getByRole("button", { name: "Verify and close", exact: true })).toBeEnabled();
  await capture(page, info, "detail-stopped");
  await page.getByRole("button", { name: "Verify and close", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Required bearing unavailable");
  await expect(page.getByRole("combobox", { name: "Verification result", exact: true })).toHaveValue("VERIFIED_STOPPED");
  await expect(page.getByRole("textbox", { name: "Verification note", exact: true })).toBeEditable();
  await capture(page, info, "independent-verification");
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("button", { name: "Verify and close", exact: true })).toBeFocused();
  const timeline = page.getByRole("list", { name: "Work Order events" });
  await page.getByRole("button", { name: "Load more history", exact: true }).click();
  await expect(timeline).toContainText("work safely stopped");
  await page.getByRole("button", { name: "Load more history", exact: true }).click();
  await expect(timeline.locator("li")).toHaveCount(3);
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await expect(timeline.locator("li")).toHaveCount(3);
  await expect(timeline).toContainText("work safely stopped");
  await timeline.scrollIntoViewIfNeeded(); await capture(page, info, "history-multiple-attempts");
  const source = page.getByRole("link", { name: "Open exact published plan" }); const href = new URL(await source.getAttribute("href") ?? "", page.url());
  expect(Object.fromEntries(href.searchParams)).toMatchObject({ factory_id: factory, caseId: detail.data.source.decision_case_id, schedule_id: detail.data.source.schedule_id, schedule_revision: String(detail.data.source.schedule_revision), assignment_id: detail.data.source.assignment_id });
  await expect(page.getByText("Historical source publication", { exact: true })).toBeVisible();
  expect(api.writes).toHaveLength(0);
});

test("report pending blocks duplicates; conflict requires review; network retry preserves key/body without reload POST", async ({ page }, info) => {
  const api = await harness(page); const detail = api.options.detail;
  detail.data.status = "IN_PROGRESS"; detail.data.revision = 7; detail.data.available_commands = ["COMPLETE", "BLOCK"];
  await page.goto(`/operations/work-orders/${id}?factory_id=${factory}`);
  await page.getByRole("button", { name: "Report completion", exact: true }).click();
  await page.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("STOPPED");
  await page.getByRole("textbox", { name: "Work performed", exact: true }).fill("Inspected the bearing and isolated the spindle.");
  await page.getByRole("textbox", { name: "Result", exact: true }).fill("Replacement required; work stopped.");
  await page.getByRole("textbox", { name: "Stop reason (required)", exact: true }).fill("Replacement bearing is not available.");
  await page.getByRole("button", { name: "Confirm report completion", exact: true }).click();
  await expect.poll(() => api.writes.length).toBe(1);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Submitting…", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Work performed", exact: true })).toBeDisabled();
  await capture(page, info, "report-pending");
  api.options.command = "conflict"; detail.data.revision = 8; api.release();
  await expect(page.getByRole("button", { name: "I reviewed the refreshed order" })).toBeEnabled();
  await expect(page.getByText("Private database details must not be displayed", { exact: true })).toHaveCount(0);
  await page.getByRole("region", { name: "Work Order commands" }).scrollIntoViewIfNeeded(); await capture(page, info, "revision-conflict");
  expect(api.writes).toHaveLength(1);
  await page.getByRole("button", { name: "I reviewed the refreshed order" }).click();
  await page.getByRole("button", { name: "Report completion", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Work performed", exact: true })).toHaveValue("Inspected the bearing and isolated the spindle.");
  api.options.command = "offline";
  await page.getByRole("button", { name: "Confirm report completion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry original intent", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry original intent", exact: true }).click();
  await expect.poll(() => api.writes.length).toBe(3);
  expect(api.writes[2]).toEqual(api.writes[1]); expect(api.writes[1].key).not.toBe(api.writes[0].key);
  expect(api.writes[0].body).toMatchObject({ expected_revision: 7 }); expect(api.writes[1].body).toMatchObject({ expected_revision: 8 });
  page.on("dialog", dialog => dialog.accept());
  await page.reload(); await expect(page.getByRole("heading", { name: "Work requirements and execution context" })).toBeVisible();
  expect(api.writes).toHaveLength(3);
});

test("read failure never becomes empty; retry, auth and preview remain read-only", async ({ page }, info) => {
  const api = await harness(page); api.options.status = 503;
  await page.goto(`/operations/work-orders?factory_id=${factory}`);
  await expect(page.getByRole("heading", { name: "Work Orders could not be verified" })).toBeVisible();
  await capture(page, info, "service-unavailable");
  await expect(page.getByRole("heading", { name: "No work orders yet" })).toHaveCount(0);
  api.options.status = 200; api.options.empty = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No work orders yet" })).toBeVisible(); await capture(page, info, "empty");
  api.options.status = 403;
  await page.getByRole("button", { name: "Refresh work orders" }).click();
  await expect(page.getByRole("heading", { name: "Work Order access denied" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Work Order results" })).toHaveCount(0);
  await page.goto(`/operations/work-orders?factory_id=${factory}&demo=1`);
  await expect(page.getByRole("heading", { name: "Work Orders is unavailable in preview mode" })).toBeVisible();
  const count = api.reads.length; await page.reload();
  await expect(page.getByRole("heading", { name: "Work Orders is unavailable in preview mode" })).toBeVisible();
  expect(api.reads).toHaveLength(count); expect(api.writes).toHaveLength(0);
});
