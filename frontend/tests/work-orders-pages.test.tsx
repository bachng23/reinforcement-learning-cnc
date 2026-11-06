import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkOrdersPage } from "@/components/pages/work-orders-page";
import { WorkOrderDetailPage } from "@/components/pages/work-order-detail-page";
import { createWorkOrdersClient } from "@/lib/work-orders/client";
import { clearWorkOrderNavigation } from "@/lib/work-orders/navigation";
import { clearWorkOrderMemory } from "@/lib/work-orders/use-work-order-intent";
import { eventsExample, workOrderActor, workOrderExample, workOrderListExample } from "./work-order-fixtures";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/operations/work-orders" }));
beforeEach(() => { clearWorkOrderMemory(); clearWorkOrderNavigation(); });
function client() {
  const state = { role: "ENGINEER", error: 0, empty: false, pages: true, detail: workOrderExample(), waiting: false };
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/auth/me")) return Response.json({ success: true, user: { ...workOrderActor, role: state.role } });
    if (state.error) return Response.json({ success: false, error: { code: state.error === 400 ? "INVALID_CURSOR" : "TEST_ERROR", message: "Private internal text" }, requestId: "request-for-support" }, { status: state.error });
    if (url.pathname.endsWith("/events")) { const after = Number(url.searchParams.get("after_sequence") ?? 0); return Response.json(eventsExample(after, state.pages && after < 2)); }
    if (url.pathname.endsWith("/work-orders")) {
      const response = workOrderListExample();
      const status = url.searchParams.get("status");
      if (status) response.data[0].status = status as typeof response.data[0]["status"];
      if (url.searchParams.has("cursor")) response.data[0].id = "a0000000-0000-4000-8000-000000000002";
      if (url.searchParams.get("factory_id") === "factory-B") { response.data[0].factory_id = "factory-B"; response.data[0].machine_id = "factory-B-machine"; }
      if (state.empty) response.data = [];
      response.meta.has_more = state.pages && !state.empty && !url.searchParams.has("cursor");
      response.meta.next_cursor = response.meta.has_more ? "opaque-signed-cursor" : null;
      return Response.json(response);
    }
    return Response.json(state.detail);
  });
  return { api: createWorkOrdersClient({ fetcher }), fetcher, state };
}

describe("Work Orders list URL / real-transport rendering", () => {
  it("renders source IDs/server flags, no fabricated title/total and no per-row detail requests", async () => {
    const { api, fetcher } = client();
    render(<WorkOrdersPage api={api} query={{ factory_id: "factory-A", limit: 25 }} />);
    const row = await screen.findByRole("row", { name: `Work order ${workOrderExample().data.id}` });
    expect(row).toHaveTextContent("MR-M03");
    expect(row).toHaveTextContent("Not overdue"); // Old planned window never uses client clock.
    expect(screen.getByText(/1 orders displayed/)).toHaveTextContent("this page only, not a total");
    expect(screen.getByRole("link", { name: `Open work order ${workOrderExample().data.id}` }).getAttribute("href")).toContain("factory_id=factory-A&returnTo=");
    expect(fetcher.mock.calls.filter(([input]) => new URL(String(input), "http://localhost").pathname.match(/work-orders\/[0-9a-f]/))).toHaveLength(0);
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("waits for URL commitment, keeps opaque next/back cursors and resets filters without extra API scope", async () => {
    const user = userEvent.setup(); const { api, fetcher } = client();
    const view = render(<WorkOrdersPage key="first" api={api} query={{ factory_id: "factory-A", limit: 25 }} />);
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    expect(push).toHaveBeenCalledWith("/operations/work-orders?factory_id=factory-A&limit=25&cursor=opaque-signed-cursor", { scroll: false });
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/work-orders?")).length).toBe(1);
    view.rerender(<WorkOrdersPage key="next" api={api} query={{ factory_id: "factory-A", limit: 25, cursor: "opaque-signed-cursor" }} />);
    await user.click(await screen.findByRole("button", { name: "Previous page" }));
    expect(push).toHaveBeenCalledWith("/operations/work-orders?factory_id=factory-A&limit=25", { scroll: false });
    await user.selectOptions(screen.getByLabelText("Status"), "ACCEPTED");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(push).toHaveBeenCalledWith("/operations/work-orders?factory_id=factory-A&status=ACCEPTED&limit=25", { scroll: false });
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/work-orders?")).length).toBe(2);
  });
  it("changes factory without displaying old rows and exposes My work as an exact backend filter", async () => {
    const user = userEvent.setup(); const { api } = client();
    const view = render(<WorkOrdersPage key="A" api={api} query={{ factory_id: "factory-A" }} />);
    await screen.findByText("MR-M03");
    await user.click(screen.getByRole("button", { name: "My work" }));
    expect(push.mock.lastCall?.[0]).toContain(`assignee_user_id=${workOrderActor.id}`);
    view.rerender(<WorkOrdersPage key="B" api={api} query={{ factory_id: "factory-B" }} />);
    expect(screen.queryByRole("row", { name: `Work order ${workOrderExample().data.id}` })).not.toBeInTheDocument();
    expect(await screen.findByText("factory-B-machine")).toBeInTheDocument();
  });
  it("distinguishes no orders and no filtered results, never offers free creation", async () => {
    const { api, state } = client(); state.empty = true;
    const view = render(<WorkOrdersPage key="all" api={api} query={{ factory_id: "factory-A" }} />);
    expect(await screen.findByRole("heading", { name: "No work orders yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review published assignments" })).toHaveAttribute("href", "/operations/schedule?factory_id=factory-A");
    view.rerender(<WorkOrdersPage key="filtered" api={api} query={{ factory_id: "factory-A", status: "BLOCKED" }} />);
    expect(await screen.findByRole("heading", { name: "No matching work orders" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create work order" })).not.toBeInTheDocument();
  });
  it.each([401, 403, 404, 503, 400])("shows %s access/service/cursor failure, requestId and explicit retry without fixture rows", async status => {
    const user = userEvent.setup(); const { api, state } = client(); state.error = status;
    render(<WorkOrdersPage api={api} query={{ factory_id: "factory-A", cursor: "old-cursor" }} />);
    await screen.findByRole("alert");
    expect(screen.getByText("request-for-support")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Work Orders table" })).not.toBeInTheDocument();
    expect(screen.queryByText("Private internal text")).not.toBeInTheDocument();
    if (status === 400) expect(screen.getByRole("link", { name: "Restart pagination" })).toHaveAttribute("href", "/operations/work-orders?factory_id=factory-A");
    state.error = 0;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Work Orders table" })).toBeInTheDocument();
  });
});

describe("Work Order detail/history", () => {
  it("renders historical source without disabling execution, paginates old attempts and preserves reports on refresh", async () => {
    const user = userEvent.setup(); const { api, state } = client();
    state.detail.data.source_is_current = false; state.detail.data.machine_in_current_snapshot = false;
    state.detail.data.available_commands = ["ASSIGN", "CANCEL"];
    render(<WorkOrderDetailPage api={api} id={state.detail.data.id} factoryHint="factory-A" returnTo="/operations/work-orders?factory_id=factory-A&status=UNASSIGNED&cursor=opaque" />);
    expect(await screen.findByText("Historical source publication")).toBeInTheDocument();
    expect(screen.getByText(/Machine absent from current observation/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel work order" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Open exact published plan" })).toHaveAttribute("href", `/operations/schedule?factory_id=factory-A&caseId=${state.detail.data.source.decision_case_id}&schedule_id=schedule-committed&schedule_revision=1&assignment_id=A-MAINT-M03`);
    expect(screen.getByRole("link", { name: "Back to filtered work orders" })).toHaveAttribute("href", "/operations/work-orders?factory_id=factory-A&status=UNASSIGNED&cursor=opaque");
    await user.click(await screen.findByRole("button", { name: "Load more history" }));
    expect(await screen.findByText("Attempt 2 inspection")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh history" })).toBeEnabled());
    expect(screen.getByText("Attempt 2 inspection")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more history" }));
    expect(await screen.findByText("Attempt 3 inspection")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Work Order events" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Load more history" })).not.toBeInTheDocument();
  });
  it("fails closed on conflicting factory hint without exposing detail/source/events", async () => {
    const { api, state } = client(); const events = vi.spyOn(api, "events");
    render(<WorkOrderDetailPage api={api} id={state.detail.data.id} factoryHint="factory-B" />);
    await screen.findByRole("alert");
    expect(screen.queryByText("MR-M03")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel work order" })).not.toBeInTheDocument();
    expect(events).not.toHaveBeenCalled();
  });
  it("shows verified STOPPED accurately and VIEWER never receives a write CTA", async () => {
    const { api, state } = client(); state.role = "VIEWER"; const order = state.detail.data;
    order.status = "CLOSED";
    order.latest_completion = { actor_id: workOrderActor.id, attempt: 2, completed_at: state.detail.meta.read_at, report: { outcome: "STOPPED", work_performed: "Inspected", result: "Stopped for safety", stop_reason: "Unsafe access" } };
    order.verification = { actor_id: "b0000000-0000-4000-8000-000000000002", result: "VERIFIED_STOPPED", note: "Independent stopped verification", verified_at: state.detail.meta.read_at };
    order.available_commands = ["CLOSE", "CANCEL"];
    render(<WorkOrderDetailPage api={api} id={order.id} />);
    expect(await screen.findByText(/does not mean the machine is recovered or healthy/)).toBeInTheDocument();
    expect(screen.getByText("VIEWER access is read-only.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify and close" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel work order" })).not.toBeInTheDocument();
  });
});
