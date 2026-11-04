import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createMockOperationsApiClient } from "../../lib/operations-api/mock";
import {
  scenarioActor,
  scenarioDraft,
  scenarioJob,
  scenarioSnapshot,
  scenarioEntities,
  engineWorkspace,
  engineEntities,
  engineJob,
  engineSensitivity,
  scenarioWorkspace,
  workspaceId,
  draftId,
  runId,
} from "../scenario-fixtures";

// Static transport fixtures exercise the real frontend HTTP path only. There is
// no Scenario worker/result simulator here, and this is NOT API/engine acceptance.
const factory = scenarioWorkspace().baseline.factory_id;
async function contractHarness(page: Page) {
  const operations = createMockOperationsApiClient();
  const workspace = scenarioWorkspace();
  const draft = scenarioDraft();
  const job = scenarioJob("SUCCEEDED");
  const state = {
    status: 200,
    viewer: false,
    lost: false,
    conflict: false,
    historical: false,
    empty: false,
  };
  const writes: { path: string; method: string; body: unknown; key: string }[] =
    [];
  const reads: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/auth/me"))
      return route.fulfill({
        json: {
          success: true,
          user: {
            ...scenarioActor,
            role: state.viewer ? "VIEWER" : "ENGINEER",
          },
        },
      });
    if (url.pathname.endsWith("/operations/overview"))
      return route.fulfill({
        json: {
          success: true,
          data: await operations.getOperationsOverview(factory),
        },
      });
    if (url.pathname.endsWith("/operations/snapshot")) {
      reads.push("snapshot");
      return route.fulfill({
        json: {
          success: true,
          data: await operations.getOperationsSnapshot(factory),
        },
      });
    }
    if (!url.pathname.startsWith("/api/v1/scenario-workspaces"))
      return route.fulfill({ status: 404 });
    if (request.method() !== "GET") {
      writes.push({
        path: url.pathname,
        method: request.method(),
        body: request.postDataJSON(),
        key: request.headers()["idempotency-key"],
      });
      if (state.lost) {
        state.lost = false;
        return route.abort("connectionfailed");
      }
      if (state.conflict) {
        state.conflict = false;
        return route.fulfill({
          status: 409,
          json: {
            success: false,
            error: {
              code: "SCENARIO_REVISION_CONFLICT",
              message: "Do not display raw database reports",
            },
            requestId: "contract-conflict",
          },
        });
      }
      // Responses are static examples; no fake engine/lease/state-transition model.
      return route.fulfill({
        status: url.pathname.endsWith("/scenarios")
          ? 201
          : request.method() === "PATCH"
            ? 200
            : 201,
        json: {
          success: true,
          data: url.pathname.includes("/scenarios") ? draft : workspace,
        },
      });
    }
    reads.push(url.pathname);
    if (state.status !== 200)
      return route.fulfill({
        status: state.status,
        json: {
          success: false,
          error: {
            code: "SCENARIO_NOT_FOUND",
            message: "Do not display raw database reports",
          },
          requestId: "contract-read",
        },
      });
    let data: unknown;
    if (url.pathname.endsWith("/baseline-entities")) data = scenarioEntities();
    else if (url.pathname.endsWith("/scenario-workspaces"))
      data = {
        items: state.empty ? [] : [workspace],
        next_cursor: url.searchParams.has("cursor") ? null : "opaque:cursor+/=",
      };
    else if (url.pathname.endsWith("/scenarios"))
      data = { items: [draft], next_cursor: null };
    else if (url.pathname.endsWith(`/scenarios/${draftId}`)) data = draft;
    else if (url.pathname.endsWith("/runs"))
      data = { items: [job], next_cursor: null };
    else if (url.pathname.endsWith(`/runs/${runId}`)) data = job;
    else
      data = state.historical
        ? {
            ...workspace,
            stale: true,
            current_head: {
              snapshot_id: "S2-current",
              plan_version: 2,
              revision: 8,
            },
          }
        : workspace;
    await route.fulfill({ json: { success: true, data } });
  });
  return { state, writes, reads, workspace, draft, job };
}
async function capture(page: Page, info: TestInfo, name: string) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  if (!process.env.SCENARIO_CAPTURE) return;
  const directory = path.resolve(
    "../docs/screenshots/scenario-planning/contract-harness",
  );
  await mkdir(directory, { recursive: true });
  const style = await page.addStyleTag({
    content: "nextjs-portal { display:none!important }",
  });
  await page.screenshot({
    path: path.join(directory, `${name}-${info.project.name}.png`),
    animations: "disabled",
  });
  await style.evaluate((element) => element.parentNode?.removeChild(element));
}

test("list/create baseline and selected editor review use exact contract fields; reload never writes", async ({
  page,
}, info) => {
  const api = await contractHarness(page);
  await page.goto(`/operations/scenarios?factory_id=${factory}`);
  await expect(
    page.getByRole("link", {
      name: "Maintenance duration review",
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, info, "workspace-list");
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("cursor"))
    .toBe("opaque:cursor+/=");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Workspace name", exact: true })
    .fill("Baseline review");
  await page.getByRole("button", { name: "Review workspace baseline" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    api.workspace.baseline.snapshot_id,
  );
  await capture(page, info, "baseline-review");
  await page.getByRole("button", { name: "Create reviewed workspace" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/operations/scenarios/${workspaceId}\\?`),
    { timeout: 20000 },
  );
  await page.getByRole("link", { name: /Longer maintenance/ }).click();
  await expect(
    page.getByRole("heading", { name: "Edit saved scenario" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Assumption template", exact: true })
    .selectOption("TECHNICIAN_UNAVAILABLE");
  await page.getByRole("button", { name: "Add assumption" }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Assumption 2 target" })
      .locator("option"),
  ).toHaveCount(scenarioSnapshot().technicians!.length + 1);
  await page
    .getByRole("region", { name: "Scenario editor" })
    .scrollIntoViewIfNeeded();
  await capture(page, info, "scenario-editor");
  await page.getByRole("button", { name: "Review draft changes" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "not an evaluated feasibility",
  );
  await capture(page, info, "draft-diff-review");
  await page.getByRole("button", { name: "Save reviewed draft" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(api.writes.at(-1)).toMatchObject({
    method: "PATCH",
    body: { expected_revision: 2 },
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Edit saved scenario" }),
  ).toBeVisible();
  expect(api.writes).toHaveLength(2);
  await expect(
    page.getByRole("button", { name: "Run saved scenario" }),
  ).toBeEnabled();
});

test("lost-save recovery preserves key/body and 409 requires explicit review", async ({
  page,
}, info) => {
  const api = await contractHarness(page);
  api.state.lost = true;
  await page.goto(
    `/operations/scenarios/${workspaceId}?factory_id=${factory}&scenario_id=${draftId}`,
  );
  await page.getByRole("button", { name: "Review draft changes" }).click();
  await page.getByRole("button", { name: "Save reviewed draft" }).click();
  await page.getByRole("button", { name: "Retry original save" }).click();
  await expect(
    page.getByRole("button", { name: "Review draft changes" }),
  ).toBeEnabled();
  expect(api.writes).toHaveLength(2);
  expect(api.writes[1]).toEqual(api.writes[0]);
  api.state.conflict = true;
  await page.getByRole("button", { name: "Review draft changes" }).click();
  await page.getByRole("button", { name: "Save reviewed draft" }).click();
  await expect(
    page.getByRole("button", { name: "I reviewed the refreshed draft" }),
  ).toBeEnabled();
  await page
    .getByRole("region", { name: "Scenario editor" })
    .scrollIntoViewIfNeeded();
  await capture(page, info, "draft-conflict");
  expect(api.writes).toHaveLength(3);
  expect(api.writes[2].key).not.toBe(api.writes[0].key);
  await expect(
    page.getByText("Do not display raw database reports", { exact: true }),
  ).toHaveCount(0);
});

test("historical S1 stays pinned without reading S2 entities; untyped results never produce KPI or a chart", async ({
  page,
}, info) => {
  const api = await contractHarness(page);
  api.state.historical = true;
  await page.goto(
    `/operations/scenarios/${workspaceId}?factory_id=${factory}&scenario_id=${draftId}&run_id=${runId}`,
  );
  await expect(
    page.getByRole("heading", { name: "Saved historical draft" }),
  ).toBeVisible();
  await capture(page, info, "historical-baseline");
  api.job.result = {
    kpis: { makespan_minutes: 987654 },
    score: 0.95,
  } as unknown as NonNullable<typeof api.job.result>;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Scenario data unavailable" }),
  ).toBeVisible();
  expect(api.reads).not.toContain("snapshot");
  await expect(page.getByText("987654", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /commit/i })).toHaveCount(0);
  await capture(page, info, "unfrozen-result");
  await expect(
    page.getByRole("button", { name: "Review LIVE handoff" }),
  ).toHaveCount(0);
  expect(api.writes).toHaveLength(0);
});

test("error, retry, VIEWER and explicit preview never trigger product writes", async ({
  page,
}, info) => {
  const api = await contractHarness(page);
  api.state.status = 503;
  await page.goto(`/operations/what-if?factory_id=${factory}`);
  await expect(page).toHaveURL(new RegExp("/operations/scenarios\\?"));
  await expect(
    page.getByRole("heading", { name: "Scenario data unavailable" }),
  ).toBeVisible();
  await capture(page, info, "service-unavailable");
  api.state.status = 200;
  api.state.viewer = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("link", {
      name: "Maintenance duration review",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create workspace", exact: true }),
  ).toHaveCount(0);
  await page.goto(
    `/operations/scenarios/${workspaceId}?factory_id=${factory}&scenario_id=${draftId}`,
  );
  await expect(
    page.getByRole("heading", { name: "Read-only role" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review draft changes" }),
  ).toBeDisabled();
  await page.goto(`/operations/scenarios?factory_id=${factory}&demo=1`);
  await expect(
    page.getByRole("heading", { name: "Scenario Planning is live-only" }),
  ).toBeVisible();
  expect(api.writes).toHaveLength(0);
});

test("computed candidate, KPI and sensitivity selection stay in the URL and never submit on inspection", async ({
  page,
}, info) => {
  const workspace = engineWorkspace();
  const source = engineJob();
  const sweepId = "50000000-0000-4000-8000-000000000001";
  const sweep = {
    ...source,
    job_id: sweepId,
    kind: "SENSITIVITY",
    source_scenario_id: null,
    source_revision: null,
    source_run_id: runId,
    result: engineSensitivity(),
  };
  const writes: string[] = [];
  const reads: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me"))
      return route.fulfill({ json: { success: true, user: scenarioActor } });
    if (route.request().method() !== "GET") {
      writes.push(url.pathname);
      return route.fulfill({
        status: 403,
        json: {
          success: false,
          error: { code: "READ_ONLY_TEST", message: "Read only" },
          requestId: "component-evidence",
        },
      });
    }
    reads.push(url.pathname);
    let data: unknown;
    if (url.pathname.endsWith("/baseline-entities")) data = engineEntities();
    else if (url.pathname.endsWith("/scenarios"))
      data = { items: [], next_cursor: null };
    else if (url.pathname.endsWith(`/sensitivity-jobs/${sweepId}`))
      data = sweep;
    else if (url.pathname.endsWith(`/runs/${runId}`)) data = source;
    else if (url.pathname.endsWith("/runs"))
      data = { items: [source], next_cursor: null };
    else data = workspace;
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto(
    `/operations/scenarios/${workspaceId}?factory_id=${workspace.baseline.factory_id}&run_id=${runId}`,
  );
  await expect(
    page.getByRole("region", { name: "Evaluated scenario", exact: true }),
  ).toBeVisible();
  if (!source.result || !("scenario" in source.result))
    throw new Error("Expected generated evaluation");
  const evaluation = source.result;
  const other = evaluation.scenario.candidates!.find(
    (candidate) =>
      candidate.candidate_plan_id !==
      evaluation.scenario.selected_candidate_id,
  )!;
  await page
    .getByRole("radio", {
      name: `Select candidate ${other.candidate_plan_id}`,
      exact: true,
    })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("candidate_id"))
    .toBe(other.candidate_plan_id);
  await expect(
    page.getByRole("region", {
      name: "Selected candidate details",
      exact: true,
    }),
  ).toContainText(other.schedule.schedule_id);
  await page
    .getByRole("region", {
      name: "Scenario candidate preview resource timeline",
    })
    .scrollIntoViewIfNeeded();
  await capture(page, info, "computed-candidate-gantt");
  await page.goto(
    `/operations/scenarios/${workspaceId}?factory_id=${workspace.baseline.factory_id}&run_id=${runId}&sensitivity_id=${sweepId}`,
  );
  await expect(
    page.getByRole("region", { name: "Evaluated sensitivity", exact: true }),
  ).toBeVisible();
  const previousReads = reads.filter((path) =>
    path.includes("/sensitivity-jobs/"),
  ).length;
  await page
    .getByRole("button", { name: "Inspect sensitivity sample 91", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("point"))
    .toBe("91");
  await expect(
    page.getByRole("region", {
      name: "Selected sensitivity sample",
      exact: true,
    }),
  ).toContainText("NO_FEASIBLE_PLAN");
  expect(
    reads.filter((path) => path.includes("/sensitivity-jobs/")),
  ).toHaveLength(previousReads);
  await page
    .getByRole("region", { name: "Sensitivity chart", exact: true })
    .scrollIntoViewIfNeeded();
  await capture(page, info, "computed-sensitivity-gaps");
  await page.reload();
  await expect(
    page.getByRole("region", {
      name: "Selected sensitivity sample",
      exact: true,
    }),
  ).toContainText("NO_FEASIBLE_PLAN");
  expect(writes).toHaveLength(0);
});
