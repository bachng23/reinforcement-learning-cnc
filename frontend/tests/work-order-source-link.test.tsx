import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntegratedSchedulePage } from "@/components/pages/integrated-schedule-page";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import WorkOrdersRoute from "@/app/operations/work-orders/page";
import WorkOrderDetailRoute from "@/app/operations/work-orders/[id]/page";
import { workOrdersApi } from "@/lib/work-orders/client";
import { bindWorkOrderNavigation, clearWorkOrderNavigation, cursorStacks, listScroll } from "@/lib/work-orders/navigation";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/operations/schedule" }));

async function publication() {
  const api = createMockOperationsApiClient(); const factoryId = "factory-demo-01";
  const basis = await api.getOperationsSnapshot(factoryId);
  const created = await api.createDecisionCase({ schema_version: "3.0", factory_id: factoryId, expected_snapshot_id: basis.snapshot_id, expected_plan_version: basis.plan_version, request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: "Source link test setup" }, planning_config: { horizon_minutes: 720 } } }, { idempotencyKey: "source-create" });
  const caseId = created.caseStatus.decision_case_id;
  await api.getDecisionCase(caseId); const ready = await api.getDecisionCase(caseId);
  const artifact = await api.getDecisionCaseRecommendation(caseId); const candidate = artifact.recommendation.candidate_plans[0];
  const identity = { schema_version: "3.0" as const, decision_case_id: caseId, recommendation_id: artifact.recommendation.recommendation_id, expected_snapshot_id: basis.snapshot_id, expected_plan_version: basis.plan_version, candidate_plan_id: candidate.candidate_plan_id, candidate_version: candidate.plan_version };
  const approved = await api.submitDecisionCommand(caseId, { ...identity, command: "APPROVE", expected_case_revision: ready.meta!.case_revision }, { idempotencyKey: "source-approve" });
  await api.submitDecisionCommand(caseId, { ...identity, command: "COMMIT", expected_case_revision: approved.meta!.case_revision }, { idempotencyKey: "source-commit" });
  const schedule = candidate.schedule;
  return { api, factoryId, caseId, hint: { scheduleId: schedule.schedule_id, revision: String(schedule.revision), assignmentId: schedule.assignments![0].assignment_id } };
}

describe("immutable Work Order source links and workspace isolation", () => {
  it("opens the exact source assignment in its immutable publication without reading current schedule", async () => {
    const { api, factoryId, caseId, hint } = await publication();
    const current = vi.spyOn(api, "getCurrentSchedule");
    const view = render(<IntegratedSchedulePage api={api} apiMode="real" factoryId={factoryId} caseId={caseId} sourceHint={hint} />);
    expect(await screen.findByRole("heading", { name: "Published schedule" })).toBeInTheDocument();
    expect(screen.getByText(/Selected source assignment:/)).toHaveTextContent(hint.assignmentId);
    expect(view.container.querySelector('[data-source-assignment="selected"]')).toBeInTheDocument();
    expect(current).not.toHaveBeenCalled();
  });
  it.each(["scheduleId", "revision", "assignmentId"] as const)("fails closed on mismatched source %s", async field => {
    const { api, factoryId, caseId, hint } = await publication();
    const current = vi.spyOn(api, "getCurrentSchedule");
    render(<IntegratedSchedulePage api={api} apiMode="real" factoryId={factoryId} caseId={caseId} sourceHint={{ ...hint, [field]: "different-source" }} />);
    expect(await screen.findByRole("heading", { name: "Historical source identity mismatch" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Published schedule" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("M01 lane")).not.toBeInTheDocument();
    expect(current).not.toHaveBeenCalled();
  });
  it("requires the source case rather than substituting the current schedule", () => {
    const api = createMockOperationsApiClient(); const current = vi.spyOn(api, "getCurrentSchedule");
    render(<IntegratedSchedulePage api={api} apiMode="real" factoryId="factory-demo-01" sourceHint={{ scheduleId: "S1", revision: "1", assignmentId: "A1" }} />);
    expect(screen.getByRole("heading", { name: "Historical source identity incomplete" })).toBeInTheDocument();
    expect(current).not.toHaveBeenCalled();
  });
  it("never reads or writes Work Orders from preview list/detail routes", async () => {
    const identity = vi.spyOn(workOrdersApi, "identity"); const list = vi.spyOn(workOrdersApi, "list"); const detail = vi.spyOn(workOrdersApi, "detail");
    const view = render(await WorkOrdersRoute({ searchParams: Promise.resolve({ demo: "1", factory_id: "factory-demo-01" }) }));
    expect(screen.getByRole("heading", { name: "Work Orders is unavailable in preview mode" })).toBeInTheDocument();
    view.unmount();
    render(await WorkOrderDetailRoute({ params: Promise.resolve({ id: "some-id" }), searchParams: Promise.resolve({ demo: "1" }) }));
    expect(screen.getByRole("heading", { name: "Work Orders is unavailable in preview mode" })).toBeInTheDocument();
    expect(identity).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(detail).not.toHaveBeenCalled();
  });
  it("clears old cursor and scroll metadata when user/factory scope changes", () => {
    clearWorkOrderNavigation(); bindWorkOrderNavigation("actor:ENGINEER:F1"); cursorStacks.set("old", ["cursor1"]); listScroll.set("old", { page: 80, table: 100 });
    bindWorkOrderNavigation("actor:ENGINEER:F1"); expect(cursorStacks.size).toBe(1);
    bindWorkOrderNavigation("actor:ENGINEER:F2"); expect(cursorStacks.size).toBe(0); expect(listScroll.size).toBe(0);
  });
});
