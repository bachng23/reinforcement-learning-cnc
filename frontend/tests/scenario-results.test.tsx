import { useState } from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EngineResultView,
  MetricTable,
  type ResultSelection,
} from "@/components/scenario-planning/engine-result";
import {
  RunReview,
  LiveHandoffReview,
} from "@/components/scenario-planning/run-panels";
import {
  assertScenarioContext,
  createScenarioClient,
  matchesScenarioSchema,
  ScenarioError,
} from "@/lib/scenario-planning/client";
import { clearScenarioMemory } from "@/lib/scenario-planning/hooks";
import {
  engineEvaluation,
  engineSensitivity,
  engineWorkspace,
  engineEntities,
  engineJob,
  scenarioActor,
  scenarioDraft,
} from "./scenario-fixtures";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
beforeEach(() => {
  clearScenarioMemory();
  push.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
function apiStub() {
  const api = createScenarioClient();
  vi.spyOn(api, "identity").mockResolvedValue(scenarioActor);
  return api;
}
function ControlledResult({ sweep = false }: { sweep?: boolean }) {
  const [selection, setSelection] = useState<ResultSelection>({});
  return (
    <EngineResultView
      result={sweep ? engineSensitivity() : engineEvaluation()}
      source={sweep ? engineEvaluation() : undefined}
      selection={selection}
      onSelection={(patch) => setSelection((old) => ({ ...old, ...patch }))}
    />
  );
}
describe("authoritative Scenario results", () => {
  it("keeps usable partial results and supplied diagnostics without inventing a timeout reason", () => {
    const result = engineEvaluation();
    result.scenario.partial = true;
    result.scenario.diagnostics = [
      {
        code: "SCENARIO_VALIDATION_FAILED",
        message: "One strategy failed during validation.",
      },
    ];
    render(<EngineResultView result={result} />);
    expect(
      screen.getByText(/partial result; inspect the returned/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("One strategy failed during validation."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/some strategies.*deadline/),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("radio", { name: /Select candidate/ }).length,
    ).toBe(result.scenario.candidates!.length);
  });
  it("uses producer-generated evaluation/sensitivity DTOs and refuses foreign identities or invalid candidates", () => {
    expect(
      matchesScenarioSchema(
        engineEvaluation(),
        "ScenarioEngine_EvaluationResult",
      ),
    ).toBe(true);
    expect(
      matchesScenarioSchema(
        engineSensitivity(),
        "ScenarioEngine_SensitivityResult",
      ),
    ).toBe(true);
    expect(() =>
      assertScenarioContext(engineJob(), engineWorkspace()),
    ).not.toThrow();
    const foreign = engineJob();
    if (!foreign.result || !("scenario" in foreign.result))
      throw new Error("Expected evaluation");
    foreign.result.identity.factory_id = "private-other-factory";
    expect(() => assertScenarioContext(foreign, engineWorkspace())).toThrow(
      "CONTEXT_MISMATCH",
    );
    const invalid = engineJob();
    if (!invalid.result || !("scenario" in invalid.result))
      throw new Error("Expected evaluation");
    invalid.result.scenario.candidates![0].validation = null;
    expect(() => assertScenarioContext(invalid, engineWorkspace())).toThrow(
      "INVALID_RESPONSE",
    );
  });
  it("validates dictionary values rather than accepting malformed scoring fields", () => {
    const result = engineEvaluation();
    const bad = {
      ...result,
      scenario: {
        ...result.scenario,
        ranking: {
          ...result.scenario.ranking,
          normalized_weights: { production: "invented" },
        },
      },
    };
    expect(matchesScenarioSchema(bad, "ScenarioEngine_EvaluationResult")).toBe(
      false,
    );
  });
  it("candidate selection keeps raw KPI, engine provenance and Gantt in sync without refetch", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ControlledResult />);
    const other = engineEvaluation().scenario.candidates!.find(
      (candidate) =>
        candidate.candidate_plan_id !==
        engineEvaluation().scenario.selected_candidate_id,
    )!;
    await user.click(
      screen.getByRole("radio", {
        name: `Select candidate ${other.candidate_plan_id}`,
      }),
    );
    const selected = screen.getByRole("region", {
      name: "Selected candidate details",
    });
    expect(
      within(selected).getByText(new RegExp(other.candidate_plan_id)),
    ).toBeInTheDocument();
    expect(
      within(selected).getByText(new RegExp(other.schedule.schedule_id)),
    ).toBeInTheDocument();
    expect(
      within(selected).getByRole("table", { name: "Selected candidate KPI" }),
    ).toHaveTextContent(String(other.kpis.makespan_minutes));
    expect(
      within(selected).getByRole("region", {
        name: "Scenario candidate preview resource timeline",
      }),
    ).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("prints backend deltas and direction verdicts exactly, keeping missing values and zero distinct", () => {
    const comparison = engineEvaluation().comparison;
    comparison.metrics[0] = {
      ...comparison.metrics[0],
      baseline: 0,
      scenario: 17,
      absolute_delta: 123.456789,
      percent_delta: null,
      change: "WORSENED_UNDER_MODEL",
      reason: "ZERO_BASELINE",
    };
    render(<MetricTable comparison={comparison} />);
    const row = screen
      .getByRole("table", { name: "Computed KPI comparison" })
      .querySelectorAll("tbody tr")[0];
    expect(
      within(row as HTMLElement).getByRole("cell", { name: "123.456789" }),
    ).toHaveClass("text-rose-800");
    expect(row).toHaveTextContent("ZERO_BASELINE");
    expect(row).toHaveTextContent("Not available");
    expect(
      within(row as HTMLElement).getByRole("cell", { name: "0" }),
    ).toBeInTheDocument();
  });
  it("refuses selectable schedules with missing validation", () => {
    const result = engineEvaluation();
    result.scenario.candidates![0].validation = null;
    render(<EngineResultView result={result} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Candidate validation is missing or invalid",
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", {
        name: "Scenario candidate preview resource timeline",
      }),
    ).not.toBeInTheDocument();
  });
  it("sensitivity keeps infeasible gaps and keyboard drill-down uses the selected saved point without requests", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ControlledResult sweep />);
    expect(screen.getAllByTestId("feasible-sample-segment")).toHaveLength(1);
    expect(screen.getAllByTestId("infeasible-gap")).toHaveLength(2);
    const point = screen.getByRole("button", {
      name: "Inspect chart sample 91: NO_FEASIBLE_PLAN",
    });
    point.focus();
    await user.keyboard("{Enter}");
    const detail = screen.getByRole("region", {
      name: "Selected sensitivity sample",
    });
    expect(detail).toHaveTextContent("Sample 91 · NO_FEASIBLE_PLAN");
    expect(detail).toHaveTextContent("No usable candidate");
    expect(within(detail).queryByRole("radio")).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not invent an exact rank threshold or confidence band when none is supplied", () => {
    render(<ControlledResult sweep />);
    expect(
      screen.getByRole("region", { name: "Sampled rank changes" }),
    ).toHaveTextContent("No rank change was reported");
    expect(
      screen.getByRole("region", { name: "Evaluated sensitivity" }),
    ).toHaveTextContent("No rank-confidence probability");
  });
});

describe("explicit run and LIVE commands", () => {
  it("requires run confirmation, guards duplicate submit and retries the identical key/body after a lost response", async () => {
    const api = apiStub();
    const user = userEvent.setup();
    const accepted = vi.fn();
    const enqueue = vi
      .spyOn(api, "enqueueRun")
      .mockRejectedValueOnce(new TypeError("lost"))
      .mockResolvedValue(engineJob());
    vi.spyOn(api, "run").mockResolvedValue(engineJob());
    const draft = {
      ...scenarioDraft(),
      overrides: engineEvaluation().effective.overrides,
    };
    render(
      <RunReview
        api={api}
        actor={scenarioActor}
        workspace={engineWorkspace()}
        snapshot={engineEntities()}
        draft={draft}
        management
        fresh
        onAccepted={accepted}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Run saved scenario" }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Enqueue reviewed run" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry same run request" }),
    );
    await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[1][1]).toEqual(enqueue.mock.calls[0][1]);
    expect(enqueue.mock.calls[1][2].key).toBe(enqueue.mock.calls[0][2].key);
  });
  it("409 requires review and cannot silently retry a refreshed revision", async () => {
    const api = apiStub();
    const user = userEvent.setup();
    const enqueue = vi
      .spyOn(api, "enqueueRun")
      .mockRejectedValue(new ScenarioError(409, "SCENARIO_REVISION_CONFLICT"));
    render(
      <RunReview
        api={api}
        actor={scenarioActor}
        workspace={engineWorkspace()}
        snapshot={engineEntities()}
        draft={scenarioDraft()}
        management
        fresh
        onAccepted={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Run saved scenario" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Enqueue reviewed run" }),
    );
    expect(
      await screen.findByRole("button", { name: "Review new run request" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Retry same run request" }),
    ).not.toBeInTheDocument();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it("viewer cannot enqueue even if an incorrect parent management flag is passed", () => {
    const api = apiStub();
    render(
      <RunReview
        api={api}
        actor={{ ...scenarioActor, role: "VIEWER" }}
        workspace={engineWorkspace()}
        snapshot={engineEntities()}
        draft={scenarioDraft()}
        management
        fresh
        onAccepted={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Run baseline" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Run saved scenario" }),
    ).toBeDisabled();
  });
  it("LIVE confirmation uses supported mapping, verifies the new case and navigates to its authoritative ID", async () => {
    const api = apiStub();
    const user = userEvent.setup();
    const workspace = engineWorkspace();
    vi.spyOn(api, "currentContext").mockResolvedValue({
      snapshot: engineEvaluation(true).effective.snapshot!,
      head: workspace.current_head!,
      publication: null,
    });
    const created = {
      workspace_id: workspace.workspace_id,
      source_run_id: engineJob(true).job_id,
      decision_case_id: "60000000-0000-4000-8000-000000000001",
      mode: "LIVE" as const,
      current_head: workspace.current_head!,
    };
    const write = vi.spyOn(api, "evaluateLive").mockResolvedValue(created);
    const verify = vi.spyOn(api, "verifyLiveCase").mockResolvedValue(created);
    render(
      <LiveHandoffReview
        api={api}
        actor={scenarioActor}
        workspace={workspace}
        source={engineJob(true)}
        fresh
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Review LIVE handoff" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Evaluate LIVE" }),
    );
    expect(write).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create LIVE case" }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][1]).toMatchObject({
      confirmation: true,
      source_run_id: created.source_run_id,
      expected_head: workspace.current_head,
    });
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining(`caseId=${created.decision_case_id}`),
    );
    expect(
      screen.queryByRole("button", { name: /commit/i }),
    ).not.toBeInTheDocument();
  });
});
