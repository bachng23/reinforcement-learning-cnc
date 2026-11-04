import { test, expect, type Page, type Locator } from "@playwright/test";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type {
  Job,
  EvaluationResult,
  SensitivityResult,
  Workspace,
  Draft,
} from "../types/generated/scenario-planning";
import type {
  DecisionCaseStatusResponse,
  FactorySnapshot,
  RunDecisionCaseRequest,
} from "../types/generated/operations";
import type {
  OperationsDecisionCaseMeta,
  OperationsDecisionCaseRecommendationResponse,
} from "../lib/operations-api/client";

const desktops = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];
test.use({ actionTimeout: 30000 });
async function desktopEvidence(page: Page, name: string, target?: Locator) {
  const directory = path.join(
    path.dirname(process.env.OPERATIONS_E2E_EVIDENCE_FILE!),
    "scenario-desktop",
  );
  await mkdir(directory, { recursive: true });
  for (const size of desktops) {
    await page.setViewportSize(size);
    if (target) {
      await target.scrollIntoViewIfNeeded();
      const bounds = await target.boundingBox();
      if (bounds)
        await page.evaluate(
          (offset) => window.scrollBy(0, offset),
          bounds.y - 128,
        );
    }
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(directory, `${name}-${size.width}x${size.height}.png`),
      animations: "disabled",
    });
  }
  await page.setViewportSize(desktops[0]);
}
async function login(page: Page, username: string, password: string) {
  await page.goto(`${process.env.OPERATIONS_E2E_WEB_URL}/login`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function enqueue(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Enqueue reviewed run", exact: true })
    .click();
}

test("real baseline → overrides → run → compare → sensitivity → reload/LIVE with scoped negatives", async ({
  page,
  browser,
}) => {
  test.setTimeout(420000);
  const api = process.env.OPERATIONS_E2E_API_URL!;
  const factory = process.env.OPERATIONS_E2E_FACTORY_ID!;
  const database = new URL(process.env.OPERATIONS_E2E_DATABASE_URL!);
  expect(database.pathname).toMatch(/_(ci|test)$/);
  expect(database.searchParams.get("schema")).toMatch(
    /^product_api_it_browser_/,
  );
  const backendRequire = createRequire(path.resolve("../backend/package.json"));
  const { PrismaClient } = backendRequire("@prisma/client");
  const { ingestFactorySnapshot } = backendRequire(
    "./src/services/operations-snapshot.service",
  );
  const db = new PrismaClient({
    datasources: { db: { url: database.toString() } },
  });
  const assertions: string[] = [];
  const submissions: { key: string; body: string }[] = [];
  const scenarios = `${api}/api/v1/scenario-workspaces`;
  const root = path.resolve("..");
  const getData = async <T>(url: string): Promise<T> => {
    const response = await page.request.get(url);
    expect(response.status()).toBe(200);
    return ((await response.json()) as { data: T }).data;
  };
  const readJob = (workspace: string, id: string, sweep = false) =>
    getData<Job>(
      `${scenarios}/${workspace}/${sweep ? "sensitivity-jobs" : "runs"}/${id}`,
    );
  const waitJob = async (workspace: string, id: string, sweep = false) => {
    await expect
      .poll(async () => (await readJob(workspace, id, sweep)).status, {
        timeout: 90000,
      })
      .toBe("SUCCEEDED");
    return readJob(workspace, id, sweep);
  };
  const workspacePath = (id: string, extra = "") =>
    `/operations/scenarios/${id}?factory_id=${factory}${extra}`;
  try {
    await page.setViewportSize(desktops[0]);
    const head = await db.operationsHead.findUnique({
      where: { factoryId: factory },
    });
    const publicationCount = await db.operationSchedule.count({
      where: { factoryId: factory },
    });
    await login(page, "admin", process.env.OPERATIONS_E2E_ADMIN_PASSWORD!);
    await page.goto(`/operations/scenarios?factory_id=${factory}`);
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await page
      .getByLabel("Workspace name", { exact: true })
      .fill("Real Scenario acceptance");
    await page
      .getByRole("button", { name: "Review workspace baseline" })
      .click();
    await page
      .getByRole("button", { name: "Create reviewed workspace" })
      .click();
    await expect(page).toHaveURL(/\/operations\/scenarios\/[a-f0-9-]+/);
    const workspace = new URL(page.url()).pathname.split("/").at(-1)!;
    await page
      .getByLabel("Scenario name", { exact: true })
      .fill("Ninety minute maintenance");
    await page
      .getByRole("button", { name: "Add assumption", exact: true })
      .click();
    await page.getByLabel("Assumption 1 duration").fill("90");
    await page.getByRole("button", { name: "Review draft changes" }).click();
    await desktopEvidence(page, "draft-review", page.getByRole("dialog"));
    await page.getByRole("button", { name: "Save reviewed draft" }).click();
    await expect(page).toHaveURL(/scenario_id=/);
    const scenarioId = new URL(page.url()).searchParams.get("scenario_id")!;
    let loseFirstResponse = true;
    // Only inject loss after the real server has accepted a POST. No product
    // API is fulfilled with a test payload, and persisted rows are checked.
    await page.route(/\/scenario-workspaces\/[^/]+\/runs$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      submissions.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData()!,
      });
      if (loseFirstResponse) {
        loseFirstResponse = false;
        await route.fetch();
        return route.abort("connectionfailed");
      }
      return route.continue();
    });
    await enqueue(page, "Run saved scenario");
    await page.getByRole("button", { name: "Retry same run request" }).click();
    await expect(page).toHaveURL(/run_id=/);
    const runId = new URL(page.url()).searchParams.get("run_id")!;
    const first = await waitJob(workspace, runId);
    const result = first.result as EvaluationResult;
    expect(result.scenario.outcome).toBe("FEASIBLE");
    expect(
      result.effective.diff.some(
        (diff) =>
          diff.field === "expected_duration_minutes" && diff.after === 90,
      ),
    ).toBe(true);
    expect(
      result.scenario.candidates!.every(
        (candidate) => candidate.validation?.verdict === "VALID",
      ),
    ).toBe(true);
    expect(submissions.slice(0, 2)).toEqual([submissions[0], submissions[0]]);
    expect(
      await db.scenarioJob.count({ where: { workspaceId: workspace } }),
    ).toBe(1);
    assertions.push(
      "lost_run_response_retries_same_key_body_single_persisted_job",
      "typed_override_changes_real_validated_schedule",
    );
    await expect(
      page.getByRole("region", { name: "Evaluated scenario", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const other = result.scenario.candidates!.find(
      (candidate) =>
        candidate.candidate_plan_id !== result.scenario.selected_candidate_id,
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
    await desktopEvidence(
      page,
      "computed-candidate-gantt",
      page.getByRole("region", {
        name: "Scenario candidate preview resource timeline",
      }),
    );
    const saved = await db.$queryRawUnsafe(
      "SELECT result_json,result_hash FROM scenario_jobs WHERE id=$1::uuid",
      runId,
    );
    expect(saved[0].result_json).toEqual(result);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Evaluated scenario", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", {
        name: `Select candidate ${other.candidate_plan_id}`,
        exact: true,
      }),
    ).toBeChecked();
    expect((await readJob(workspace, runId)).result).toEqual(result);
    expect(
      await db.scenarioJob.count({ where: { workspaceId: workspace } }),
    ).toBe(1);
    assertions.push(
      "candidate_url_kpi_provenance_gantt_and_reload_match_postgresql_without_enqueue",
    );

    const draft = await getData<Draft>(
      `${scenarios}/${workspace}/scenarios/${scenarioId}`,
    );
    const concurrent = await page.request.patch(
      `${scenarios}/${workspace}/scenarios/${scenarioId}`,
      {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          name: draft.name,
          note: "Concurrent server edit",
          overrides: draft.overrides,
          objective_weights: draft.objective_weights,
          expected_revision: draft.revision,
        },
      },
    );
    expect(concurrent.status()).toBe(200);
    await page
      .getByLabel("Scenario note", { exact: true })
      .fill("My reviewed note is retained");
    await page.getByRole("button", { name: "Review draft changes" }).click();
    await page.getByRole("button", { name: "Save reviewed draft" }).click();
    await page
      .getByRole("button", { name: "I reviewed the refreshed draft" })
      .click();
    await expect(page.getByLabel("Scenario note", { exact: true })).toHaveValue(
      "My reviewed note is retained",
    );
    await page.getByRole("button", { name: "Review draft changes" }).click();
    await page.getByRole("button", { name: "Save reviewed draft" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readJob(workspace, runId)).source_revision).toBe(
      draft.revision,
    );
    await enqueue(page, "Run saved scenario");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("run_id"))
      .not.toBe(runId);
    const replayId = new URL(page.url()).searchParams.get("run_id")!;
    const replay = (await waitJob(workspace, replayId))
      .result as EvaluationResult;
    expect(replay.scenario).toEqual(result.scenario);
    expect(replay.semantic_input_hash).toBe(result.semantic_input_hash);
    assertions.push(
      "revision_conflict_retains_input_and_prior_frozen_run",
      "same_effective_inputs_ignore_new_job_uuid_and_note_revision",
    );
    const sensitivity = page.getByRole("region", {
      name: "Sensitivity analysis",
      exact: true,
    });
    await sensitivity
      .getByRole("button", { name: "Review sweep inputs" })
      .click();
    await sensitivity
      .getByRole("button", { name: "Start sensitivity job" })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sensitivity_id"))
      .toBeTruthy();
    const physicalId = new URL(page.url()).searchParams.get("sensitivity_id")!;
    const physical = await waitJob(workspace, physicalId, true);
    expect(physical.points).toHaveLength(5);
    await expect(
      page.getByRole("region", { name: "Evaluated sensitivity", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await desktopEvidence(
      page,
      "physical-sensitivity",
      page.getByRole("region", { name: "Sensitivity chart", exact: true }),
    );
    const physicalResult = physical.result as SensitivityResult;
    const point = physicalResult.points[2];
    await page
      .getByRole("button", {
        name: `Inspect sensitivity sample ${point.value}`,
        exact: true,
      })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("point"))
      .toBe(String(point.value));
    await expect(
      page.getByRole("region", {
        name: "Selected sensitivity sample",
        exact: true,
      }),
    ).toContainText(`Sample ${point.value}`);
    const jobCount = await db.scenarioJob.count({
      where: { workspaceId: workspace },
    });
    await page.reload();
    await expect(
      page.getByRole("region", {
        name: "Selected sensitivity sample",
        exact: true,
      }),
    ).toContainText(`Sample ${point.value}`);
    expect(
      await db.scenarioJob.count({ where: { workspaceId: workspace } }),
    ).toBe(jobCount);
    await sensitivity
      .getByLabel("Sweep parameter")
      .selectOption("OBJECTIVE_WEIGHT");
    await sensitivity
      .getByRole("button", { name: "Review sweep inputs" })
      .click();
    await sensitivity
      .getByRole("button", { name: "Start sensitivity job" })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sensitivity_id"))
      .not.toBe(physicalId);
    const weightId = new URL(page.url()).searchParams.get("sensitivity_id")!;
    const sweep = (await waitJob(workspace, weightId, true))
      .result as SensitivityResult;
    expect(
      sweep.points.every(
        (sample) =>
          JSON.stringify(sample.evaluation.candidates) ===
          JSON.stringify(result.scenario.candidates),
      ),
    ).toBe(true);
    expect(
      sweep.points.every(
        (sample) =>
          sample.evaluation.ranking?.normalization_reference_id ===
          result.scenario.ranking?.normalization_reference_id,
      ),
    ).toBe(true);
    assertions.push(
      "five_physical_samples_and_point_url_reload_keep_saved_outcomes",
      "five_weight_samples_reuse_candidate_kpi_and_normalization_reference",
    );
    await enqueue(page, "Run baseline");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("run_id"))
      .not.toBe(replayId);
    const baselineId = new URL(page.url()).searchParams.get("run_id")!;
    await waitJob(workspace, baselineId);
    await page.reload();
    const baselineSelect = page.getByRole("checkbox", {
      name: `Compare run ${baselineId}`,
      exact: true,
    });
    await baselineSelect.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("compare"))
      .toBe(baselineId);
    await expect(baselineSelect).toBeChecked();
    const compareResponse = page.waitForResponse((response) =>
      response.url().includes(`/scenario-workspaces/${workspace}/compare`),
    );
    const scenarioSelect = page.getByRole("checkbox", {
      name: `Compare run ${runId}`,
      exact: true,
    });
    await scenarioSelect.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("compare")?.split(","))
      .toEqual([baselineId, runId]);
    await expect(scenarioSelect).toBeChecked();
    expect((await compareResponse).status()).toBe(200);
    await expect(
      page
        .getByRole("region", { name: "Saved run comparison" })
        .getByRole("table", { name: "Computed KPI comparison" }),
    ).toBeVisible();
    await desktopEvidence(
      page,
      "saved-run-comparison",
      page.getByRole("region", { name: "Saved run comparison" }),
    );
    expect(
      await db.operationsHead.findUnique({ where: { factoryId: factory } }),
    ).toEqual(head);
    expect(
      await db.operationSchedule.count({ where: { factoryId: factory } }),
    ).toBe(publicationCount);
    assertions.push(
      "baseline_and_scenario_compare_through_real_engine",
      "simulation_keeps_operational_head_and_publication_unchanged",
    );

    await page.getByRole("link", { name: "New draft", exact: true }).click();
    // The old saved editor is still mounted until the App Router transition resolves.
    // Wait for the destination before filling its inputs.
    await expect(page).not.toHaveURL(/scenario_id=/);
    await expect(
      page.getByRole("heading", { name: "New scenario draft", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Scenario name", { exact: true })
      .fill("Supported LIVE defer");
    await page
      .getByLabel("Assumption template", { exact: true })
      .selectOption("DEFER_MAINTENANCE");
    await page
      .getByRole("button", { name: "Add assumption", exact: true })
      .click();
    const snapshotResponse = await getData<{ snapshot: FactorySnapshot }>(
      `${api}/api/v1/operations/snapshot?factory_id=${factory}`,
    );
    const deferAt = new Date(
      Date.parse(snapshotResponse.snapshot.planning_window.start_at) +
        10 * 60000,
    ).toISOString();
    await page
      .getByLabel("Assumption 1 earliest start")
      .fill(deferAt.slice(0, 16));
    await page.getByRole("button", { name: "Review draft changes" }).click();
    await page.getByRole("button", { name: "Save reviewed draft" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await enqueue(page, "Run saved scenario");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("run_id"))
      .not.toBe(baselineId);
    const liveRunId = new URL(page.url()).searchParams.get("run_id")!;
    const liveRun = await waitJob(workspace, liveRunId);
    expect((liveRun.result as EvaluationResult).live_mapping.supported).toBe(
      true,
    );
    await page.getByRole("button", { name: "Review LIVE handoff" }).click();
    await page
      .getByRole("button", { name: "Evaluate LIVE", exact: true })
      .click();
    await desktopEvidence(page, "live-confirmation", page.getByRole("dialog"));
    await page
      .getByRole("button", { name: "Create LIVE case", exact: true })
      .click();
    await expect(page).toHaveURL(/\/operations\/recommendations\?.*caseId=/);
    const liveCaseId = new URL(page.url()).searchParams.get("caseId")!;
    await expect
      .poll(
        async () =>
          (
            await getData<DecisionCaseStatusResponse>(
              `${api}/api/v1/decision-cases/${liveCaseId}`,
            )
          ).status,
        { timeout: 90000 },
      )
      .toBe("AWAITING_APPROVAL");
    const liveArtifact =
      await getData<OperationsDecisionCaseRecommendationResponse>(
        `${api}/api/v1/decision-cases/${liveCaseId}/recommendation`,
      );
    expect(
      liveArtifact.recommendation?.candidate_plans?.some(
        (candidate) =>
          candidate.candidate_plan_id ===
          (liveRun.result as EvaluationResult).scenario.selected_candidate_id,
      ),
    ).toBe(false);
    expect(
      await db.scenarioLiveEvaluation.count({ where: { runId: liveRunId } }),
    ).toBe(1);
    assertions.push(
      "supported_defer_opens_new_authoritative_live_case_for_fresh_planning_and_approval",
    );

    // A real concurrent observation change after confirmation must produce 409,
    // without replacing the reviewed head or automatically re-submitting.
    await page.goto(workspacePath(workspace, `&run_id=${liveRunId}`));
    await page.getByRole("button", { name: "Review LIVE handoff" }).click();
    await page
      .getByRole("button", { name: "Evaluate LIVE", exact: true })
      .click();
    const nextSnapshot = structuredClone(snapshotResponse.snapshot);
    nextSnapshot.snapshot_id = "scenario-after-analysis-S2";
    nextSnapshot.captured_at = new Date(
      Date.parse(nextSnapshot.captured_at) + 60000,
    ).toISOString();
    const currentHead = await db.operationsHead.findUnique({
      where: { factoryId: factory },
    });
    await ingestFactorySnapshot(
      {
        factoryId: factory,
        expectedHeadRevision: currentHead.revision,
        snapshot: nextSnapshot,
        sourceId: "scenario-browser-stale-boundary",
      },
      db,
    );
    await page
      .getByRole("button", { name: "Create LIVE case", exact: true })
      .click();
    await expect(page.getByText(/The baseline is stale/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Evaluate LIVE", exact: true }),
    ).toBeDisabled();
    expect(
      await db.scenarioLiveEvaluation.count({ where: { runId: liveRunId } }),
    ).toBe(1);
    await desktopEvidence(
      page,
      "stale-live-context",
      page.getByText(/The baseline is stale/),
    );
    await page.reload();
    const historical = await getData<Workspace>(`${scenarios}/${workspace}`);
    expect(historical.stale).toBe(true);
    expect(historical.baseline.snapshot_id).toBe(head.snapshotId);
    const entities = await getData<{ baseline: { snapshot_id: string } }>(
      `${scenarios}/${workspace}/baseline-entities`,
    );
    expect(entities.baseline.snapshot_id).toBe(head.snapshotId);
    await expect(
      page.getByRole("heading", { name: "New scenario draft", exact: true }),
    ).toBeVisible();
    assertions.push(
      "stale_head_409_never_rebases_or_creates_another_case",
      "historical_editor_entities_stay_pinned_after_S2",
    );

    // Independently specified 90-minute-slot golden input, persisted through
    // the existing trusted ingestion adapter into this owned test schema.
    const golden = JSON.parse(
      await readFile(
        path.join(
          root,
          "ai_services/tests/fixtures/scenario-maintenance-90-minute-slot.json",
        ),
        "utf8",
      ),
    ) as { factory_snapshot: FactorySnapshot };
    golden.factory_snapshot.factory_id = "factory-scenario-golden";
    await db.factory.create({
      data: {
        factoryId: golden.factory_snapshot.factory_id,
        name: "Scenario golden constraint factory",
      },
    });
    await ingestFactorySnapshot(
      {
        factoryId: golden.factory_snapshot.factory_id,
        expectedHeadRevision: 0,
        snapshot: golden.factory_snapshot,
        sourceId: "scenario-independent-golden",
      },
      db,
    );
    await page.goto(
      `/operations/scenarios?factory_id=${golden.factory_snapshot.factory_id}`,
    );
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await page
      .getByLabel("Workspace name", { exact: true })
      .fill("Golden slot boundary");
    await page
      .getByRole("button", { name: "Review workspace baseline" })
      .click();
    await page
      .getByRole("button", { name: "Create reviewed workspace" })
      .click();
    await expect(page).toHaveURL(/\/operations\/scenarios\/[a-f0-9-]+/);
    const goldenWorkspace = new URL(page.url()).pathname.split("/").at(-1)!;
    await page
      .getByLabel("Scenario name", { exact: true })
      .fill("Golden sixty minute source");
    await page
      .getByRole("button", { name: "Add assumption", exact: true })
      .click();
    await page.getByLabel("Assumption 1 duration").fill("60");
    await page.getByRole("button", { name: "Review draft changes" }).click();
    await page.getByRole("button", { name: "Save reviewed draft" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await enqueue(page, "Run saved scenario");
    await expect(page).toHaveURL(/run_id=/);
    const goldenRunId = new URL(page.url()).searchParams.get("run_id")!;
    await waitJob(goldenWorkspace, goldenRunId);
    const goldenInputs = page.getByRole("region", {
      name: "Sensitivity analysis",
      exact: true,
    });
    for (const [index, value] of [30, 60, 90, 91, 120].entries())
      await goldenInputs
        .getByLabel(`Sensitivity point ${index + 1}`)
        .fill(String(value));
    await goldenInputs
      .getByRole("button", { name: "Review sweep inputs" })
      .click();
    await goldenInputs
      .getByRole("button", { name: "Start sensitivity job" })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sensitivity_id"))
      .toBeTruthy();
    const goldenSweepId = new URL(page.url()).searchParams.get(
      "sensitivity_id",
    )!;
    const goldenResult = (await waitJob(goldenWorkspace, goldenSweepId, true))
      .result as SensitivityResult;
    expect(goldenResult.points.map((point) => point.status)).toEqual([
      "FEASIBLE",
      "FEASIBLE",
      "FEASIBLE",
      "NO_FEASIBLE_PLAN",
      "NO_FEASIBLE_PLAN",
    ]);
    await page
      .getByRole("button", {
        name: "Inspect sensitivity sample 91",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", {
        name: "Selected sensitivity sample",
        exact: true,
      }),
    ).toContainText("NO_FEASIBLE_PLAN");
    await expect(page.getByTestId("infeasible-gap")).toHaveCount(2);
    await desktopEvidence(
      page,
      "golden-infeasible-gaps",
      page.getByRole("region", { name: "Sensitivity chart", exact: true }),
    );
    assertions.push(
      "independent_golden_90_91_boundary_has_real_infeasible_gaps_and_point_constraints",
    );

    const viewerContext = await browser.newContext({
      baseURL: process.env.OPERATIONS_E2E_WEB_URL,
    });
    const outsiderContext = await browser.newContext({
      baseURL: process.env.OPERATIONS_E2E_WEB_URL,
    });
    try {
      const viewer = await viewerContext.newPage();
      await login(
        viewer,
        process.env.OPERATIONS_E2E_VIEWER_USERNAME!,
        process.env.OPERATIONS_E2E_ROLE_PASSWORD!,
      );
      await viewer.goto(workspacePath(workspace, `&run_id=${runId}`));
      await expect(
        viewer.getByRole("heading", { name: "Read-only role", exact: true }),
      ).toBeVisible();
      await expect(
        viewer.getByRole("button", { name: "Run saved scenario", exact: true }),
      ).toBeDisabled();
      expect(
        (
          await viewer.request.post(`${scenarios}/${workspace}/runs`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: { kind: "BASELINE" },
          })
        ).status(),
      ).toBe(403);
      expect(
        (await viewer.request.get(`${scenarios}/${goldenWorkspace}`)).status(),
      ).toBe(404);
      const outsider = await outsiderContext.newPage();
      await login(
        outsider,
        process.env.OPERATIONS_E2E_OUTSIDER_USERNAME!,
        process.env.OPERATIONS_E2E_ROLE_PASSWORD!,
      );
      expect(
        (await outsider.request.get(`${scenarios}/${workspace}`)).status(),
      ).toBe(404);
      expect(
        (
          await outsider.request.get(`${scenarios}/${workspace}/runs/${runId}`)
        ).status(),
      ).toBe(404);
      await db.user.update({
        where: { username: process.env.OPERATIONS_E2E_VIEWER_USERNAME! },
        data: { active: false },
      });
      await viewer
        .getByRole("button", { name: "Refresh workspace", exact: true })
        .click();
      await expect(viewer).toHaveURL(/\/login/);
      expect(
        (await viewer.request.get(`${scenarios}/${workspace}`)).status(),
      ).toBe(401);
      assertions.push(
        "viewer_read_only_and_server_403",
        "cross_factory_workspace_run_ids_are_scoped_404",
        "inactive_actor_loses_access_without_stale_data",
      );
    } finally {
      await viewerContext.close();
      await outsiderContext.close();
    }

    // Explicit canonical SIMULATION_ONLY command denial through the real API.
    const latest = await db.operationsHead.findUnique({
      where: { factoryId: factory },
    });
    const canonical = JSON.parse(
      await readFile(
        path.join(root, "contracts/v3/fixtures/demo-health-alert.json"),
        "utf8",
      ),
    ) as Pick<RunDecisionCaseRequest, "planning_config">;
    const simulation = await page.request.post(`${api}/api/v1/decision-cases`, {
      headers: { "Idempotency-Key": randomUUID() },
      data: {
        schema_version: "3.0",
        factory_id: factory,
        expected_snapshot_id: latest.snapshotId,
        expected_plan_version: latest.planVersion,
        request: {
          mode: "SIMULATION_ONLY",
          trigger: {
            type: "WHAT_IF",
            scenario_id: randomUUID(),
            assumptions: {},
          },
          planning_config: canonical.planning_config,
        },
      },
    });
    expect(simulation.status()).toBe(202);
    const simId = (
      (await simulation.json()) as { data: DecisionCaseStatusResponse }
    ).data.decision_case_id;
    await expect
      .poll(
        async () =>
          (
            await getData<DecisionCaseStatusResponse>(
              `${api}/api/v1/decision-cases/${simId}`,
            )
          ).status,
        { timeout: 90000 },
      )
      .toBe("AWAITING_APPROVAL");
    const simRead = await page.request.get(
      `${api}/api/v1/decision-cases/${simId}`,
    );
    const simMeta = (
      (await simRead.json()) as { meta: OperationsDecisionCaseMeta }
    ).meta;
    const simArtifact =
      await getData<OperationsDecisionCaseRecommendationResponse>(
        `${api}/api/v1/decision-cases/${simId}/recommendation`,
      );
    const simPackage = simArtifact.recommendation!;
    const simCandidate = simPackage.candidate_plans.find(
      (candidate) =>
        candidate.candidate_plan_id === simPackage.recommended_plan_id,
    )!;
    const command = {
      schema_version: "3.0",
      decision_case_id: simId,
      recommendation_id: simPackage.recommendation_id,
      candidate_plan_id: simCandidate.candidate_plan_id,
      candidate_version: simCandidate.plan_version,
      expected_snapshot_id: latest.snapshotId,
      expected_plan_version: latest.planVersion,
    };
    const approve = await page.request.post(
      `${api}/api/v1/decision-cases/${simId}/decision`,
      {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          ...command,
          command: "APPROVE",
          expected_case_revision: simMeta.case_revision,
        },
      },
    );
    expect(approve.status()).toBe(200);
    const approved = (
      (await approve.json()) as { meta: OperationsDecisionCaseMeta }
    ).meta;
    const commit = await page.request.post(
      `${api}/api/v1/decision-cases/${simId}/decision`,
      {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          ...command,
          command: "COMMIT",
          expected_case_revision: approved.case_revision,
        },
      },
    );
    expect(commit.status()).toBe(409);
    expect(
      ((await commit.json()) as { error: { code: string } }).error.code,
    ).toBe("SIMULATION_ONLY");
    expect(
      await db.operationsHead.findUnique({ where: { factoryId: factory } }),
    ).toEqual(latest);
    assertions.push(
      "real_simulation_only_case_commit_is_denied_and_preserves_publication",
    );
    await writeFile(
      path.join(
        path.dirname(process.env.OPERATIONS_E2E_EVIDENCE_FILE!),
        "scenario-evidence.json",
      ),
      JSON.stringify(
        {
          git_sha: process.env.OPERATIONS_E2E_GIT_SHA,
          producer_sha: "d49ddfbbe3ffddb51cea03077aa032e4acb2ee1e",
          source_tree_dirty: process.env.OPERATIONS_E2E_SOURCE_DIRTY === "true",
          run: Number(process.env.OPERATIONS_E2E_RUN),
          workspace_id: workspace,
          run_id: runId,
          live_case_id: liveCaseId,
          golden_workspace_id: goldenWorkspace,
          semantic_input_hash: result.semantic_input_hash,
          viewports: desktops,
          assertions_passed: assertions,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
});
