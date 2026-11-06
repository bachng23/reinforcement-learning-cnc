import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationWorkOrders } from "@/components/work-orders/publication-work-orders";
import { WorkspaceUserContext } from "@/lib/workspace-user";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { createWorkOrdersClient, WorkOrdersError } from "@/lib/work-orders/client";
import { clearWorkOrderMemory } from "@/lib/work-orders/use-work-order-intent";
import { workOrderActor, workOrderExample } from "./work-order-fixtures";
import type { OperationsCommitMetadata } from "@/lib/operations-api/client";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
beforeEach(() => clearWorkOrderMemory());
async function setup() {
  const contextApi = createMockOperationsApiClient();
  const factory = "factory-demo-01";
  const basis = await contextApi.getOperationsSnapshot(factory);
  const created = await contextApi.createDecisionCase({ schema_version: "3.0", factory_id: factory, expected_snapshot_id: basis.snapshot_id, expected_plan_version: basis.plan_version, request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: "Unit fixture setup" }, planning_config: { horizon_minutes: 720 } } }, { idempotencyKey: "fixture-create" });
  const caseId = created.caseStatus.decision_case_id;
  await contextApi.getDecisionCase(caseId);
  const ready = await contextApi.getDecisionCase(caseId);
  const artifact = await contextApi.getDecisionCaseRecommendation(caseId);
  const candidate = artifact.recommendation.candidate_plans[0];
  const identity = { schema_version: "3.0" as const, decision_case_id: caseId, recommendation_id: artifact.recommendation.recommendation_id, expected_snapshot_id: basis.snapshot_id, expected_plan_version: basis.plan_version, candidate_plan_id: candidate.candidate_plan_id, candidate_version: candidate.plan_version };
  const approved = await contextApi.submitDecisionCommand(caseId, { ...identity, command: "APPROVE", expected_case_revision: ready.meta!.case_revision }, { idempotencyKey: "fixture-approve" });
  await contextApi.submitDecisionCommand(caseId, { ...identity, command: "COMMIT", expected_case_revision: approved.meta!.case_revision }, { idempotencyKey: "fixture-commit" });
  const overview = await contextApi.getOperationsOverview(factory); overview.context.head_revision = 21;
  const read = vi.spyOn(contextApi, "getOperationsOverview").mockResolvedValue(overview);
  const snapshot = (await contextApi.getOperationsSnapshot(factory)).snapshot;
  const schedule = (await contextApi.getCurrentSchedule(factory)).schedule!;
  const assignment = schedule.assignments!.find(item => item.assignment_type === "MAINTENANCE")!;
  const commit: OperationsCommitMetadata = { factory_id: factory, decision_case_id: caseId, snapshot_id: snapshot.snapshot_id, schedule_id: schedule.schedule_id, schedule_revision: schedule.revision, schedule_hash: "a".repeat(64), plan_version: overview.context.plan_version, actor_id: workOrderActor.id, committed_at: overview.context.read_at };
  const api = createWorkOrdersClient(); vi.spyOn(api, "identity").mockResolvedValue(workOrderActor);
  const result = workOrderExample(); result.data.factory_id = factory; result.data.basis_snapshot_id = snapshot.snapshot_id;
  result.data.source = { ...result.data.source, decision_case_id: commit.decision_case_id, basis_snapshot_id: snapshot.snapshot_id, schedule_id: schedule.schedule_id, schedule_revision: schedule.revision, schedule_hash: commit.schedule_hash, assignment_id: assignment.assignment_id, published_plan_version: commit.plan_version };
  const create = vi.spyOn(api, "create").mockResolvedValue(result); vi.spyOn(api, "detail").mockResolvedValue(result);
  render(<WorkspaceUserContext.Provider value={workOrderActor}><PublicationWorkOrders api={api} contextApi={contextApi} commit={commit} schedule={schedule} snapshot={snapshot} /></WorkspaceUserContext.Provider>);
  const user = userEvent.setup(); await user.click(screen.getByText("Maintenance assignments / Work Orders"));
  await user.click(await screen.findByRole("button", { name: "Review create work order" }));
  return { api, create, read, overview, result, commit, assignment, user };
}

describe("create from authoritative COMMIT publication", () => {
  it("uses the read head revision, not schedule revision, then reads and opens the returned exact order", async () => {
    const { create, commit, assignment, user, result } = await setup();
    const modal = within(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toHaveTextContent(commit.factory_id);
    await user.click(modal.getByRole("button", { name: "Create work order" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toEqual({ factory_id: commit.factory_id, expected_head: { snapshot_id: commit.snapshot_id, plan_version: commit.plan_version, revision: 21 }, source: { decision_case_id: commit.decision_case_id, schedule_id: commit.schedule_id, schedule_revision: commit.schedule_revision, schedule_hash: commit.schedule_hash, assignment_id: assignment.assignment_id } });
    expect(push).toHaveBeenCalledWith(`/operations/work-orders/${result.data.id}?factory_id=${commit.factory_id}`);
  });
  it("network uncertainty retains the identical source/head/key and never creates another intent", async () => {
    const { create, user } = await setup();
    create.mockRejectedValueOnce(new TypeError("Lost response"));
    const modal = within(screen.getByRole("dialog"));
    await user.click(modal.getByRole("button", { name: "Create work order" }));
    await user.click(await modal.findByRole("button", { name: "Retry original create" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
    expect(create.mock.calls[1][1].key).toBe(create.mock.calls[0][1].key);
  });
  it("a rejected follow-up read after a successful create never unlocks another create intent", async () => {
    const { api, create, user } = await setup();
    vi.mocked(api.detail).mockRejectedValueOnce(new WorkOrdersError(404, "WORK_ORDER_NOT_FOUND"));
    const modal = within(screen.getByRole("dialog"));
    await user.click(modal.getByRole("button", { name: "Create work order" }));
    await user.click(await modal.findByRole("button", { name: "Retry original create" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
    expect(create.mock.calls[1][1].key).toBe(create.mock.calls[0][1].key);
  });
  it("overlap override is reviewed explicitly and uses a new key/body with a real reason", async () => {
    const { create, user } = await setup();
    create.mockRejectedValueOnce(new WorkOrdersError(409, "WORK_ORDER_OVERLAP"));
    const modal = within(screen.getByRole("dialog"));
    await user.click(modal.getByRole("button", { name: "Create work order" }));
    await user.click(await modal.findByRole("button", { name: "I reviewed the rejection and refreshed context" }));
    expect(modal.getByRole("button", { name: "Create with explicit overlap override" })).toBeDisabled();
    await user.type(modal.getByLabelText(/Explicit overlap override reason/), "Reviewed staffing and safe overlap");
    await user.click(modal.getByRole("button", { name: "Create with explicit overlap override" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0][0]).not.toHaveProperty("overlap_override_reason");
    expect(create.mock.calls[1][0]).toHaveProperty("overlap_override_reason", "Reviewed staffing and safe overlap");
    expect(create.mock.calls[1][1].key).not.toBe(create.mock.calls[0][1].key);
  });
  it("source-plan conflict preserves S1/P1 selection and never switches to P2", async () => {
    const { create, read, overview, assignment, user } = await setup();
    create.mockRejectedValue(new WorkOrdersError(409, "SOURCE_PLAN_CHANGED"));
    read.mockResolvedValue({ ...overview, context: { ...overview.context, plan_version: 2, publication: { ...overview.context.publication!, schedule_id: "new-P2" } } });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create work order" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("no P2 assignment is substituted"));
    expect(screen.getByRole("dialog")).toHaveTextContent(assignment.assignment_id);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Create work order" })).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

it("finds and opens only the authorized exact-origin order", async () => {
 const {api, commit, assignment, result, user, create} = await setup();
 const lookup = vi.spyOn(api, "byOrigin").mockResolvedValue({success: true, data: {id: result.data.id}, meta: result.meta});
 await user.click(screen.getByRole("button", {name: "Close review"}));
 await user.click(screen.getByRole("button", {name: "Find existing work order"}));
 const link = await screen.findByRole("link", {name: "Open existing work order"});
 expect(link).toHaveAttribute("href", `/operations/work-orders/${result.data.id}?factory_id=${commit.factory_id}`);
 expect(lookup).toHaveBeenCalledWith(commit.factory_id, commit.schedule_id, commit.schedule_revision, assignment.assignment_id);
 expect(create).not.toHaveBeenCalled();
});
