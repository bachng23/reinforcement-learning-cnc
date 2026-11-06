import type { ReactNode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/components/pages/production-dashboard-page";
import { OperationsApiError } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { WorkspaceUserContext } from "@/lib/workspace-user";
import { deferred } from "./product-api-test-utils";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/overview" }));
const factoryId = "factory-demo-01";

async function populated() {
  const api = createMockOperationsApiClient();
  const context = await api.getOperationsSnapshot(factoryId);
  for (let index = 0; index < 8; index++) {
    const created = await api.createDecisionCase({ schema_version: "3.0", factory_id: factoryId,
      expected_snapshot_id: context.snapshot_id, expected_plan_version: context.plan_version,
      request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: `Planning ${index}` }, planning_config: { horizon_minutes: 720 } } }, { idempotencyKey: `seed-overview-${index}` });
    await api.getDecisionCase(created.caseStatus.decision_case_id);
    await api.getDecisionCase(created.caseStatus.decision_case_id);
  }
  return api;
}

describe("production factory Overview", () => {
  it("uses summary totals rather than the six-item preview and drills into exact factory/mode/status", async () => {
    const api = await populated();
    const overview = await api.getOperationsOverview(factoryId);
    const summaryRead = vi.spyOn(api, "getOperationsOverview");
    const list = vi.spyOn(api, "listDecisionCases");
    render(<DashboardPage api={api} factoryId={factoryId} />);
    const review = await screen.findByRole("link", { name: "LIVE cases awaiting approval" });
    expect(review).toHaveTextContent("8");
    expect(review).toHaveAttribute("href", `/operations/cases?factory_id=${factoryId}&status=AWAITING_APPROVAL&mode=LIVE`);
    expect(screen.getByRole("link", { name: "LIVE approved, not published" })).toHaveAttribute("href", `/operations/cases?factory_id=${factoryId}&status=APPROVED&mode=LIVE`);
    expect(screen.getAllByRole("link", { name: /^Review case / })).toHaveLength(6);
    expect(screen.getByRole("link", { name: `Review case ${overview.review_preview.items[0].decision_case_id}` })).toHaveAttribute("href", `/operations/recommendations?factory_id=${factoryId}&caseId=${overview.review_preview.items[0].decision_case_id}`);
    expect(summaryRead).toHaveBeenCalledWith(factoryId, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Selected machine detail" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).not.toHaveTextContent("DEMO");
    expect(screen.queryByText(/AI agents active/)).not.toBeInTheDocument();
  });

  it("distinguishes empty cases, no publication and missing health without turning unknown into zero", async () => {
    const api = createMockOperationsApiClient();
    const overview = await api.getOperationsOverview(factoryId);
    overview.context.publication = null;
    overview.context.plan_version = 0;
    vi.spyOn(api, "getOperationsOverview").mockResolvedValue(overview);
    const snapshot = await api.getOperationsSnapshot(factoryId);
    const schedule = await api.getCurrentSchedule(factoryId);
    vi.spyOn(api, "getOperationsSnapshot").mockResolvedValue({ ...snapshot, plan_version: 0, snapshot: { ...snapshot.snapshot, health_snapshots: [] } });
    vi.spyOn(api, "getCurrentSchedule").mockResolvedValue({ ...schedule, plan_version: 0, schedule: null, basis_snapshot: null });
    const user = userEvent.setup();
    render(<DashboardPage api={api} factoryId={factoryId} />);
    expect(await screen.findByText("No LIVE cases awaiting approval")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No published schedule" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Choose machine" }));
    await user.click(screen.getAllByRole("option")[0]);
    expect(screen.getAllByText("Chưa có dữ liệu")).toHaveLength(4);
    expect(screen.getByText(/No health observation was supplied/)).toBeInTheDocument();
  });

  it.each(["factory", "snapshot", "plan", "head"])("hides inspector/create on %s mismatch without silently retrying or writing", async dimension => {
    const api = createMockOperationsApiClient();
    const snapshot = await api.getOperationsSnapshot(factoryId);
    const schedule = await api.getCurrentSchedule(factoryId);
    const changed = { ...snapshot,
      ...(dimension === "factory" ? { factory_id: "other-factory" } : {}),
      ...(dimension === "snapshot" ? { snapshot_id: "new-observation", snapshot: { ...snapshot.snapshot, snapshot_id: "new-observation" } } : {}),
      ...(dimension === "plan" ? { plan_version: 2 } : {}),
      ...(dimension === "head" ? { head_revision: 999 } : {}),
    };
    vi.spyOn(api, "getOperationsSnapshot").mockResolvedValue(changed);
    vi.spyOn(api, "getCurrentSchedule").mockResolvedValue({ ...schedule, snapshot_id: changed.snapshot_id, plan_version: changed.plan_version });
    const create = vi.spyOn(api, "createDecisionCase");
    render(<DashboardPage api={api} factoryId={factoryId} />);
    expect(await screen.findByRole("heading", { name: "Observation context changed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose machine" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Planning reason")).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 503, 0])("shows %s failures, allows retry, and never substitutes demo", async status => {
    const user = userEvent.setup();
    const api = createMockOperationsApiClient();
    const read = vi.spyOn(api, "getOperationsOverview").mockRejectedValueOnce(status ? new OperationsApiError(status, null) : new TypeError("Network unreachable"));
    render(<DashboardPage api={api} factoryId={factoryId} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "LIVE cases awaiting approval" })).not.toBeInTheDocument();
    expect(screen.queryByText("CNC M01")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "LIVE cases awaiting approval" })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shows a supplied correlation reference, clears it after retry, and keeps safe hook errors", async () => {
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getOperationsOverview").mockRejectedValueOnce(new OperationsApiError(503, {
      schema_version: "3.0", error_id: "error-id", code: "OPERATIONS_VALIDATOR_UNAVAILABLE", correlation_id: "request-123", retryable: true, message: "Internal unsafe detail", details: [],
    }));
    render(<DashboardPage api={api} factoryId={factoryId} />);
    expect(await screen.findByText("request-123")).toBeInTheDocument();
    expect(screen.queryByText("Internal unsafe detail")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("link", { name: "LIVE cases awaiting approval" });
    expect(screen.queryByText("request-123")).not.toBeInTheDocument();
  });

  it("keeps demo explicit, scopes all links, and commits a factory change to the URL", async () => {
    const user = userEvent.setup();
    render(<DashboardPage api={createMockOperationsApiClient()} factoryId={factoryId} apiMode="mock" />);
    expect(await screen.findByRole("note")).toHaveTextContent("DEMO / PREVIEW");
    expect(screen.getByRole("link", { name: "Open integrated schedule" })).toHaveAttribute("href", `/operations/schedule?factory_id=${factoryId}&demo=1`);
    await user.clear(screen.getByLabelText("Factory ID"));
    await user.type(screen.getByLabelText("Factory ID"), "factory-two");
    await user.click(screen.getByRole("button", { name: "Open factory" }));
    expect(push).toHaveBeenCalledWith("/overview?factory_id=factory-two&demo=1");
  });

  it("refreshes summary on matching invalidation, aborts old reads and has no write CTA for VIEWER", async () => {
    const api = createMockOperationsApiClient();
    const summary = await api.getOperationsOverview(factoryId);
    const hold = deferred<typeof summary>();
    const read = vi.spyOn(api, "getOperationsOverview").mockReturnValueOnce(hold.promise);
    const view = render(<WorkspaceUserContext.Provider value={{ id: "viewer", role: "VIEWER" }}><DashboardPage api={api} factoryId={factoryId} /></WorkspaceUserContext.Provider>);
    const signal = read.mock.calls[0][1]!.signal!;
    act(() => window.dispatchEvent(new CustomEvent("operations-context-changed", { detail: { factoryId } })));
    await screen.findByRole("heading", { name: "Planning access" });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: "Create case" })).not.toBeInTheDocument();
    act(() => hold.resolve(summary));
    const count = read.mock.calls.length;
    act(() => window.dispatchEvent(new CustomEvent("operations-context-changed", { detail: { factoryId: "other" } })));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(count));
    view.unmount();
    expect(read.mock.lastCall?.[1]?.signal?.aborted).toBe(true);
  });
});
