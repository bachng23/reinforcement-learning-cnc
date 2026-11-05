import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioEditor } from "@/components/scenario-planning/editor";
import {
  RunInspector,
  SensitivityInputs,
  LiveHandoffReview,
} from "@/components/scenario-planning/run-panels";
import {
  ScenarioWorkspacePage,
  validateCompareSelection,
} from "@/components/pages/scenario-workspace-page";
import { ScenarioWorkspacesPage } from "@/components/pages/scenario-workspaces-page";
import {
  createScenarioClient,
  ScenarioError,
} from "@/lib/scenario-planning/client";
import { clearScenarioMemory } from "@/lib/scenario-planning/hooks";
import {
  scenarioActor,
  scenarioDraft,
  scenarioJob,
  scenarioEntities,
  engineSnapshot,
  engineWorkspace,
  engineEntities,
  engineJob,
  scenarioWorkspace,
  draftId,
  runId,
  workspaceId,
} from "./scenario-fixtures";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/operations/scenarios",
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
beforeEach(() => clearScenarioMemory());
function stub() {
  const api = createScenarioClient();
  vi.spyOn(api, "identity").mockResolvedValue(scenarioActor);
  vi.spyOn(api, "workspace").mockResolvedValue(scenarioWorkspace());
  vi.spyOn(api, "baselineEntities").mockResolvedValue(scenarioEntities());
  vi.spyOn(api, "draft").mockResolvedValue(scenarioDraft());
  vi.spyOn(api, "listDrafts").mockResolvedValue({
    items: [scenarioDraft()],
    next_cursor: null,
  });
  vi.spyOn(api, "listRuns").mockResolvedValue({
    items: [scenarioJob("SUCCEEDED")],
    next_cursor: null,
  });
  vi.spyOn(api, "run").mockResolvedValue(scenarioJob("SUCCEEDED"));
  return api;
}
describe("Scenario editor independent contract UI", () => {
  it("selects Technician resources, reviews all three overrides and saves the exact revision", async () => {
    const user = userEvent.setup();
    const api = stub();
    const saved = vi.spyOn(api, "saveDraft").mockResolvedValue(scenarioDraft());
    const accepted = vi.fn();
    render(
      <ScenarioEditor
        api={api}
        actor={scenarioActor}
        fresh
        workspace={scenarioWorkspace()}
        draft={scenarioDraft()}
        snapshot={scenarioEntities()}
        onSaved={accepted}
        refresh={vi.fn()}
      />,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Assumption template" }),
      "TECHNICIAN_UNAVAILABLE",
    );
    await user.click(screen.getByRole("button", { name: "Add assumption" }));
    expect(
      within(
        screen.getByRole("combobox", { name: "Assumption 2 target" }),
      ).getAllByRole("option"),
    ).toHaveLength(scenarioEntities().technicians!.length + 1);
    expect(
      screen.queryByRole("textbox", { name: /uuid/i }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Assumption template" }),
      "DEFER_MAINTENANCE",
    );
    await user.click(screen.getByRole("button", { name: "Add assumption" }));
    await user.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "not an evaluated feasibility",
    );
    expect(saved).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Save reviewed draft" }),
    );
    await waitFor(() => expect(accepted).toHaveBeenCalled());
    expect(saved.mock.calls[0][1]).toMatchObject({
      expected_revision: 2,
      overrides: [
        { type: "MAINTENANCE_DURATION" },
        { type: "TECHNICIAN_UNAVAILABLE" },
        { type: "DEFER_MAINTENANCE" },
      ],
    });
  });
  it("rejects duplicate assumptions before submitting and enforces max five", async () => {
    const user = userEvent.setup();
    const api = stub();
    const save = vi.spyOn(api, "saveDraft");
    render(
      <ScenarioEditor
        api={api}
        actor={scenarioActor}
        fresh
        workspace={scenarioWorkspace()}
        draft={scenarioDraft()}
        snapshot={scenarioEntities()}
        onSaved={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add assumption" }));
    await user.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    expect(
      await screen.findByText(/Each type\/target pair/),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add assumption" }));
    await user.click(screen.getByRole("button", { name: "Add assumption" }));
    await user.click(screen.getByRole("button", { name: "Add assumption" }));
    expect(
      screen.getByRole("button", { name: "Add assumption" }),
    ).toBeDisabled();
  });
  it("409 preserves draft input, refreshes and requires explicit review before a new key/revision", async () => {
    const user = userEvent.setup();
    const api = stub();
    const refresh = vi.fn();
    const save = vi
      .spyOn(api, "saveDraft")
      .mockRejectedValueOnce(
        new ScenarioError(409, "SCENARIO_REVISION_CONFLICT"),
      )
      .mockResolvedValueOnce(scenarioDraft());
    const props = {
      api,
      actor: scenarioActor,
      fresh: true,
      workspace: scenarioWorkspace(),
      draft: scenarioDraft(),
      snapshot: scenarioEntities(),
      onSaved: vi.fn(),
      refresh,
    };
    const view = render(<ScenarioEditor {...props} />);
    await user.clear(screen.getByRole("textbox", { name: "Scenario note" }));
    await user.type(
      screen.getByRole("textbox", { name: "Scenario note" }),
      "Keep my requested note",
    );
    await user.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save reviewed draft" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    view.rerender(
      <ScenarioEditor
        {...props}
        draft={{
          ...scenarioDraft(),
          revision: 4,
          note: "Other manager saved this",
        }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Scenario note" })).toHaveValue(
      "Keep my requested note",
    );
    expect(save).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "I reviewed the refreshed draft" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save reviewed draft" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0][1]).toHaveProperty("expected_revision", 2);
    expect(save.mock.calls[1][1]).toHaveProperty("expected_revision", 4);
    expect(save.mock.calls[1][2].key).not.toBe(save.mock.calls[0][2].key);
  });
  it("uncertain save removes the modal and exposes exact-intent retry without changing body", async () => {
    const user = userEvent.setup();
    const api = stub();
    const save = vi
      .spyOn(api, "saveDraft")
      .mockRejectedValue(new TypeError("Lost response"));
    render(
      <ScenarioEditor
        api={api}
        actor={scenarioActor}
        fresh
        workspace={scenarioWorkspace()}
        draft={scenarioDraft()}
        snapshot={scenarioEntities()}
        onSaved={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save reviewed draft" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry original save" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1]);
    expect(save.mock.calls[1][2].key).toBe(save.mock.calls[0][2].key);
  });
});

describe("workspace/read/result boundaries", () => {
  it.each([
    ["SUCCEEDED", 1],
    ["QUEUED", 2],
  ] as const)(
    "revalidates the run list only when its recorded %s status changes",
    async (status, reads) => {
      const api = stub();
      vi.mocked(api.listRuns)
        .mockResolvedValueOnce({
          items: [scenarioJob(status)],
          next_cursor: null,
        })
        .mockResolvedValue({
          items: [scenarioJob("SUCCEEDED")],
          next_cursor: null,
        });
      render(
        <ScenarioWorkspacePage
          api={api}
          workspaceId={workspaceId}
          selection={{
            factory_id: "factory-demo-01",
            scenario_id: draftId,
            run_id: runId,
          }}
        />,
      );
      await screen.findByRole("heading", { name: "Scenario run" });
      await waitFor(() =>
        expect(
          within(screen.getByRole("region", { name: "Saved runs" })).getByText(
            "SUCCEEDED",
          ),
        ).toBeInTheDocument(),
      );
      expect(api.workspace).toHaveBeenCalledTimes(reads);
      expect(api.listRuns).toHaveBeenCalledTimes(reads);
    },
  );
  it("keeps immutable run selection usable during a background refresh while commands stay disabled", async () => {
    const user = userEvent.setup();
    const api = stub();
    push.mockClear();
    const enqueue = vi.spyOn(api, "enqueueRun");
    vi.mocked(api.listRuns).mockResolvedValue({
      items: [
        {
          ...scenarioJob("SUCCEEDED"),
          source_scenario_id: null,
          source_revision: null,
        },
      ],
      next_cursor: null,
    });
    render(
      <ScenarioWorkspacePage
        api={api}
        workspaceId={workspaceId}
        selection={{ factory_id: "factory-demo-01" }}
      />,
    );
    const choice = await screen.findByRole("checkbox", {
      name: `Compare run ${runId}`,
    });
    vi.mocked(api.workspace).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    await user.click(screen.getByRole("button", { name: "Refresh workspace" }));
    expect(screen.getByRole("button", { name: "Run baseline" })).toBeDisabled();
    expect(choice).toBeEnabled();
    await user.click(choice);
    expect(push.mock.calls.at(-1)?.[0]).toContain(`compare=${runId}`);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("write authorization loss revalidates actor and removes the old private form", async () => {
    const user = userEvent.setup();
    const api = stub();
    const save = vi.spyOn(api, "saveDraft").mockImplementation(async () => {
      vi.mocked(api.identity).mockResolvedValue({
        ...scenarioActor,
        role: "VIEWER",
      });
      throw new ScenarioError(403, "FORBIDDEN");
    });
    render(
      <ScenarioWorkspacePage
        api={api}
        workspaceId={workspaceId}
        selection={{
          factory_id: scenarioWorkspace().baseline.factory_id,
          scenario_id: draftId,
        }}
      />,
    );
    const note = await screen.findByRole("textbox", { name: "Scenario note" });
    await user.clear(note);
    await user.type(note, "Private unsaved text from previous access");
    await user.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save reviewed draft" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Read-only role" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Private unsaved text from previous access"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review draft changes" }),
    ).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("a failed follow-up GET after receipt keeps the save outcome uncertain and replays the original request", async () => {
    const user = userEvent.setup();
    const api = stub();
    const save = vi.spyOn(api, "saveDraft").mockResolvedValue(scenarioDraft());
    vi.mocked(api.draft).mockRejectedValueOnce(
      new ScenarioError(404, "SCENARIO_NOT_FOUND"),
    );
    render(
      <ScenarioEditor
        api={api}
        actor={scenarioActor}
        fresh
        workspace={scenarioWorkspace()}
        draft={scenarioDraft()}
        snapshot={scenarioEntities()}
        onSaved={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Review draft changes" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save reviewed draft" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry original save" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1]);
    expect(save.mock.calls[1][2].key).toBe(save.mock.calls[0][2].key);
  });
  it("loads selected draft/run from URL and never enqueues or invents KPI from an unfrozen result", async () => {
    const api = stub();
    vi.mocked(api.run).mockResolvedValue({
      ...scenarioJob("SUCCEEDED"),
      result: {
        kpis: { makespan_minutes: 987654 },
        score: 0.95,
        recommended_strategy: "invented",
      } as unknown as NonNullable<ReturnType<typeof scenarioJob>["result"]>,
    });
    const enqueue = vi.spyOn(api, "enqueueRun");
    const live = vi.spyOn(api, "evaluateLive");
    render(
      <ScenarioWorkspacePage
        api={api}
        workspaceId={workspaceId}
        selection={{
          factory_id: scenarioWorkspace().baseline.factory_id,
          scenario_id: draftId,
          run_id: runId,
        }}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Pinned baseline" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Scenario data unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("987654")).not.toBeInTheDocument();
    expect(screen.queryByText("0.95")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run saved scenario" }),
    ).toBeEnabled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
  });
  it("historical basis remains visible when target entities are unavailable; no latest substitution", async () => {
    const api = stub();
    vi.mocked(api.workspace).mockResolvedValue({
      ...scenarioWorkspace(),
      stale: true,
      current_head: { snapshot_id: "S2", plan_version: 2, revision: 9 },
    });
    vi.mocked(api.baselineEntities).mockRejectedValue(
      new ScenarioError(503, "BASELINE_ENTITIES_UNAVAILABLE"),
    );
    render(
      <ScenarioWorkspacePage
        api={api}
        workspaceId={workspaceId}
        selection={{
          factory_id: scenarioWorkspace().baseline.factory_id,
          scenario_id: draftId,
        }}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Saved historical draft" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /The immutable baseline entities are not available/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Scenario editor" }),
    ).not.toBeInTheDocument();
  });
  it.each([401, 403, 404, 503, 0])(
    "renders safe %s list errors and manual read retry",
    async (status) => {
      const user = userEvent.setup();
      const api = stub();
      const list = vi
        .spyOn(api, "listWorkspaces")
        .mockRejectedValueOnce(new ScenarioError(status, "TEST_FAILURE"))
        .mockResolvedValueOnce({ items: [], next_cursor: null });
      render(<ScenarioWorkspacesPage api={api} factoryId="factory-demo-01" />);
      await screen.findByRole("button", { name: "Try again" });
      expect(
        screen.queryByRole("heading", { name: "No saved workspaces" }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByRole("heading", { name: "No saved workspaces" }),
      ).toBeInTheDocument();
      expect(list).toHaveBeenCalledTimes(2);
    },
  );
  it("VIEWER cannot edit and no write is submitted", async () => {
    const api = stub();
    vi.mocked(api.identity).mockResolvedValue({
      ...scenarioActor,
      role: "VIEWER",
    });
    render(
      <ScenarioWorkspacePage
        api={api}
        workspaceId={workspaceId}
        selection={{
          factory_id: scenarioWorkspace().baseline.factory_id,
          scenario_id: draftId,
        }}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Read-only role" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review draft changes" }),
    ).toBeDisabled();
  });
  it("retains timeout/no-feasible/failed point rows without backfilled KPI or fake aggregate confidence", () => {
    const job = scenarioJob("SUCCEEDED");
    job.kind = "SENSITIVITY";
    job.points = ["FEASIBLE", "NO_FEASIBLE_PLAN", "TIMEOUT", "FAILED"].map(
      (status, point_index) => ({
        point_index,
        status: status as (typeof job.points)[number]["status"],
        value: point_index * 30,
        error_code: null,
        result:
          status === "FEASIBLE"
            ? ({ kpis: { invented: 987654 } } as unknown as NonNullable<
                (typeof job.points)[number]["result"]
              >)
            : null,
      }),
    );
    render(<RunInspector job={job} />);
    for (const status of ["FEASIBLE", "NO_FEASIBLE_PLAN", "TIMEOUT", "FAILED"])
      expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.queryByText("987654")).not.toBeInTheDocument();
    expect(screen.queryByText(/95%/)).not.toBeInTheDocument();
  });
  it("bounds compare to same-workspace baseline + three completed scenarios", () => {
    const base = { ...scenarioJob("SUCCEEDED", false), job_id: "base" };
    const scenarios = [1, 2, 3, 4].map((i) => ({
      ...scenarioJob("SUCCEEDED"),
      job_id: String(i),
    }));
    expect(
      validateCompareSelection(["base", "1", "2", "3"], [base, ...scenarios]),
    ).toBeUndefined();
    expect(validateCompareSelection(["1", "2"], [base, ...scenarios])).toMatch(
      /baseline/,
    );
    expect(
      validateCompareSelection(
        ["base", "1", "2", "3", "4"],
        [base, ...scenarios],
      ),
    ).toMatch(/four/);
  });
  it("reviews five explicit weight samples without normalization or sending sensitivity", async () => {
    const user = userEvent.setup();
    const api = stub();
    const enqueue = vi.spyOn(api, "enqueueSensitivity");
    render(
      <SensitivityInputs
        workspace={engineWorkspace()}
        snapshot={engineEntities()}
        source={engineJob()}
        api={api}
        actor={scenarioActor}
        fresh
        onAccepted={vi.fn()}
      />,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sweep parameter" }),
      "OBJECTIVE_WEIGHT",
    );
    await user.click(
      screen.getByRole("button", { name: "Review sweep inputs" }),
    );
    expect(screen.getByText(/values 0, 0.5, 1, 2, 4/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start sensitivity job" }),
    ).toBeEnabled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("resolves the frozen duration target when baseline entities arrive after the saved result, preserving an explicit selection", async () => {
    const user = userEvent.setup();
    const api = stub();
    const enqueue = vi.spyOn(api, "enqueueSensitivity");
    const snapshot = engineEntities();
    const props = {
      workspace: engineWorkspace(),
      source: engineJob(),
      api,
      actor: scenarioActor,
      onAccepted: vi.fn(),
    };
    const view = render(<SensitivityInputs {...props} fresh={false} />);
    const target = screen.getByRole("combobox", {
      name: "Baseline maintenance target",
    });
    expect(target).toBeDisabled();
    view.rerender(<SensitivityInputs {...props} snapshot={snapshot} fresh />);
    expect(target).toHaveValue(
      snapshot.maintenance_requests[0].maintenance_request_id,
    );
    await user.click(
      screen.getByRole("button", { name: "Review sweep inputs" }),
    );
    expect(
      screen.getByRole("button", { name: "Start sensitivity job" }),
    ).toBeEnabled();
    expect(enqueue).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to editor" }));
    await user.selectOptions(target, "");
    view.rerender(
      <SensitivityInputs
        {...props}
        snapshot={structuredClone(snapshot)}
        fresh
      />,
    );
    expect(target).toHaveValue("");
  });
  it("prepares fixed-input sensitivity during background reads but requires revalidation and explicit confirmation before submission", async () => {
    const user = userEvent.setup();
    const api = stub();
    const enqueue = vi.spyOn(api, "enqueueSensitivity");
    const props = {
      workspace: engineWorkspace(),
      source: engineJob(),
      snapshot: engineEntities(),
      api,
      actor: scenarioActor,
      onAccepted: vi.fn(),
    };
    const view = render(<SensitivityInputs {...props} fresh={false} />);
    const review = screen.getByRole("button", { name: "Review sweep inputs" });
    expect(review).toBeEnabled();
    await user.click(review);
    expect(
      screen.getByText("Start sensitivity job", { selector: "button" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Refreshing source context before confirmation/),
    ).toBeInTheDocument();
    expect(enqueue).not.toHaveBeenCalled();
    view.rerender(<SensitivityInputs {...props} fresh />);
    expect(
      screen.getByRole("button", { name: "Start sensitivity job" }),
    ).toBeEnabled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("LIVE review shows S1/P1 vs S2/P2, requires supported frozen mapping and never commits simulation", async () => {
    const user = userEvent.setup();
    const api = stub();
    vi.spyOn(api, "currentContext").mockResolvedValue({
      snapshot: { ...engineSnapshot(), snapshot_id: "S2" },
      head: { snapshot_id: "S2", plan_version: 2, revision: 8 },
      publication: null,
    });
    render(
      <LiveHandoffReview
        workspace={engineWorkspace()}
        source={engineJob(true)}
        fresh
        api={api}
        actor={scenarioActor}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Review LIVE handoff" }),
    );
    expect(
      await screen.findByText(/The baseline is stale/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Evaluate LIVE" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /commit/i }),
    ).not.toBeInTheDocument();
  });
});
