import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OperationsOverviewPage } from "@/components/pages/operations-overview-page";
import { RecommendationCenterPage } from "@/components/pages/recommendation-center-page";
import { createOperationsApiClient, OperationsApiError, type OperationsDecisionCaseReadResponse, type OperationsDecisionCommand } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { createRealRecommendationCenterDataSource } from "@/lib/recommendation-center";
import { deferred } from "@/tests/product-api-test-utils";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/operations", useRouter: () => router }));
vi.mock("@/lib/operations-api/actor", () => ({ getOperationsActorId: async () => "preview-operator" }));

const factoryId = "factory-demo-01";
async function readyCase() {
  const api = createMockOperationsApiClient();
  const snapshot = await api.getOperationsSnapshot(factoryId);
  const created = await api.createDecisionCase({ schema_version: "3.0", factory_id: factoryId,
    expected_snapshot_id: snapshot.snapshot_id, expected_plan_version: snapshot.plan_version,
    request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: "Review production" }, planning_config: { horizon_minutes: 720 } } }, { idempotencyKey: "create-case" });
  const caseId = created.caseStatus.decision_case_id;
  await api.getDecisionCase(caseId);
  const status = await api.getDecisionCase(caseId);
  const artifact = await api.getDecisionCaseRecommendation(caseId);
  return { api, caseId, status, artifact };
}

describe("create, live approval and publication", () => {
  it("creates from Overview head tokens and navigates using the backend case ID", async () => {
    const user = userEvent.setup();
    const api = createMockOperationsApiClient();
    const create = vi.spyOn(api, "createDecisionCase");
    render(<OperationsOverviewPage api={api} apiMode="real" factoryId={factoryId} />);
    await screen.findByLabelText("Planning reason");
    await user.type(screen.getByLabelText("Planning reason"), "Review maintenance windows");
    await user.click(screen.getByRole("button", { name: "Create case" }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const response = await create.mock.results[0].value;
    expect(router.push).toHaveBeenCalledWith(`/operations/recommendations?caseId=${response.caseStatus.decision_case_id}`);
    expect(create.mock.calls[0][0]).toMatchObject({ expected_plan_version: 1, request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: "Review maintenance windows" } } });
    expect(create.mock.calls[0][1]).toMatchObject({ idempotencyKey: expect.any(String), signal: expect.any(AbortSignal) });
  });

  it("requires explicit review after stale create context and never resubmits automatically", async () => {
    const user = userEvent.setup();
    const api = createMockOperationsApiClient();
    const create = vi.spyOn(api, "createDecisionCase").mockRejectedValue(new OperationsApiError(409, null));
    render(<OperationsOverviewPage api={api} factoryId={factoryId} apiMode="real" />);
    await screen.findByLabelText("Planning reason");
    await user.type(screen.getByLabelText("Planning reason"), "Review");
    await user.click(screen.getByRole("button", { name: "Create case" }));
    expect(await screen.findByRole("button", { name: "Refresh context and review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create case" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Refresh context and review" }));
    await screen.findByLabelText("6 machines");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("approves the chosen candidate, refetches, commits separately and renders the published schedule", async () => {
    const user = userEvent.setup();
    const { api, caseId, artifact } = await readyCase();
    const submit = vi.spyOn(api, "submitDecisionCommand");
    const read = vi.spyOn(api, "getDecisionCase");
    const scheduleRead = vi.spyOn(api, "getCurrentSchedule");
    const selected = artifact.recommendation.candidate_plans[1];
    render(<RecommendationCenterPage api={api} apiMode="real" caseId={caseId} />);
    await screen.findByRole("heading", { name: "Candidate comparison" });
    await user.click(screen.getByRole("button", { name: new RegExp(selected.candidate_plan_id) }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(selected.source_engine_version);
    expect(screen.getByRole("dialog")).toHaveTextContent("VALID");
    expect(screen.getByRole("button", { name: "Commit approved schedule" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirm approve" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1]).toMatchObject({ command: "APPROVE", candidate_plan_id: selected.candidate_plan_id, candidate_version: selected.plan_version, expected_plan_version: 1 });
    expect(read).toHaveBeenCalledTimes(2);
    // Comparing another candidate after approval must not change what COMMIT publishes.
    await user.click(screen.getByRole("button", { name: new RegExp(artifact.recommendation.candidate_plans[0].candidate_plan_id) }));
    await user.click(screen.getByRole("button", { name: "Commit approved schedule" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(selected.candidate_plan_id);
    await user.click(screen.getByRole("button", { name: "Confirm commit" }));
    expect(await screen.findByRole("heading", { name: "Published schedule" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Current committed schedule" });
    expect(screen.getByText(/Published plan version 2/)).toBeInTheDocument();
    expect(scheduleRead).toHaveBeenCalled();
    expect(submit.mock.calls[1][1]).toMatchObject({ command: "COMMIT", candidate_plan_id: selected.candidate_plan_id, expected_case_revision: 3 });
    expect(submit.mock.calls[0][2].idempotencyKey).not.toBe(submit.mock.calls[1][2].idempotencyKey);
  });

  it("requires a rejection note and never publishes on reject", async () => {
    const user = userEvent.setup();
    const { api, caseId } = await readyCase();
    const submit = vi.spyOn(api, "submitDecisionCommand");
    const before = await api.getCurrentSchedule(factoryId);
    render(<RecommendationCenterPage api={api} apiMode="real" caseId={caseId} />);
    await screen.findByRole("heading", { name: "Candidate comparison" });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));
    expect(screen.getByText("A rejection note is required.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Decision note"), "  Maintenance conflict  ");
    await user.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() => expect(screen.getByText("Stage").parentElement).toHaveTextContent("REJECTED"));
    expect(submit.mock.calls[0][1]).toMatchObject({ command: "REJECT", note: "Maintenance conflict" });
    expect(submit.mock.calls[0][1]).not.toHaveProperty("candidate_plan_id");
    expect(await api.getCurrentSchedule(factoryId)).toEqual(before);
  });

  it("blocks double submit while pending and recovers lost approval with the original key/body", async () => {
    const user = userEvent.setup();
    const { api, caseId } = await readyCase();
    const actualSubmit = api.submitDecisionCommand.bind(api);
    const lost = deferred<OperationsDecisionCaseReadResponse>();
    const submit = vi.spyOn(api, "submitDecisionCommand")
      .mockImplementationOnce(async (...args) => { await actualSubmit(...args); return lost.promise; }).mockImplementation(actualSubmit);
    const page = render(<RecommendationCenterPage api={api} apiMode="real" caseId={caseId} />);
    await screen.findByRole("heading", { name: "Candidate comparison" });
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.dblClick(screen.getByRole("button", { name: "Confirm approve" }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Commit approved schedule" })).toBeDisabled();
    act(() => lost.reject(new TypeError("Lost response")));
    await screen.findByRole("button", { name: "Recover decision outcome" });
    page.unmount();
    render(<RecommendationCenterPage api={api} apiMode="real" caseId={caseId} />);
    await screen.findByRole("button", { name: "Recover decision outcome" });
    expect(submit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Recover decision outcome" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit approved schedule" })).toBeEnabled());
    expect(submit.mock.calls[1][1]).toEqual(submit.mock.calls[0][1]);
    expect(submit.mock.calls[1][2].idempotencyKey).toBe(submit.mock.calls[0][2].idempotencyKey);
  });

  it("409 refetches case state and requires review before another command", async () => {
    const user = userEvent.setup();
    const { api, caseId } = await readyCase();
    const submit = vi.spyOn(api, "submitDecisionCommand").mockRejectedValue(new OperationsApiError(409, null));
    const read = vi.spyOn(api, "getDecisionCase");
    render(<RecommendationCenterPage api={api} apiMode="real" caseId={caseId} />);
    await screen.findByRole("heading", { name: "Candidate comparison" });
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approve" }));
    await screen.findByRole("button", { name: "I have reviewed the refreshed case" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "I have reviewed the refreshed case" }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each(["stale", "no-permission", "invalid"])("fails closed for %s and keeps MODIFY disabled", async scenario => {
    const { api, caseId, status, artifact } = await readyCase();
    if (scenario === "stale") status.meta!.stale = true;
    if (scenario === "no-permission") status.meta!.available_commands = [];
    if (scenario === "invalid") artifact.recommendation.candidate_plans[0].validation!.verdict = "INVALID";
    vi.spyOn(api, "getDecisionCase").mockResolvedValue(status);
    vi.spyOn(api, "getDecisionCaseRecommendation").mockResolvedValue(artifact);
    const submit = vi.spyOn(api, "submitDecisionCommand");
    render(<RecommendationCenterPage api={api} apiMode="real" caseId={caseId} />);
    await screen.findByRole("heading", { name: "Human decision and publication" });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Modify" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Commit approved schedule" })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("transports case/head/candidate versions separately against the backend sample DTO", async () => {
    const body: OperationsDecisionCommand = { schema_version: "3.0", decision_case_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recommendation_id: "recommendation-1", expected_snapshot_id: "snapshot-1", expected_case_revision: 6,
      expected_plan_version: 0, command: "APPROVE", candidate_plan_id: "candidate-1", candidate_version: 17 };
    const { responses } = await import("../../backend/examples/decision-commands.json");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(responses.APPROVE));
    const client = createOperationsApiClient({ fetcher, baseUrl: "/api/v1" });
    const result = await client.submitDecisionCommand(body.decision_case_id, body, { idempotencyKey: "approval-1" });
    expect(result.meta?.case_revision).toBe(7);
    expect(result.meta?.approved_candidate?.candidate_version).toBe(17);
    expect(result.meta?.current_context?.plan_version).toBe(0);
    expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify(body));
  });
});
