import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DecisionCasesPage } from "@/components/pages/decision-cases-page";
import { createOperationsApiClient } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { caseListFixture } from "./decision-case-read-fixtures";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => "/operations/cases", useRouter: () => ({ replace }) }));

describe("Decision Cases discovery", () => {
  it("renders backend identity/basis/head/stale/publication and opens the exact case", async () => {
    const page = caseListFixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page));
    const api = createOperationsApiClient({ fetcher });
    render(<DecisionCasesPage api={api} apiMode="real" initialQuery={{ factory_id: "factory-1" }} />);
    expect(screen.getByText("Loading decision cases")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: `Open recommendation for ${page.data[0].decision_case_id}` });
    expect(link).toHaveAttribute("href", `/operations/recommendations?factory_id=factory-1&caseId=${page.data[0].decision_case_id}`);
    expect(screen.getByText("Stale basis")).toBeInTheDocument();
    expect(screen.getByText(/Published plan version 1/)).toBeInTheDocument();
    expect(screen.getByText("Case revision")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("no fixture fallback");
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("keeps cursor/filter metadata, loads more, and resets cursor on filter changes and refresh", async () => {
    const user = userEvent.setup();
    const page = caseListFixture();
    const second = { ...page.data[0], decision_case_id: "second-case", status: "APPROVED" as const, mode: "SIMULATION_ONLY" as const };
    const fetcher = vi.fn<typeof fetch>(async input => {
      const params = new URL(String(input), "http://localhost").searchParams;
      if (params.has("status")) return Response.json({ ...page, data: [second] });
      if (params.has("cursor")) return Response.json({ ...page, data: [second] });
      return Response.json({ ...page, meta: { ...page.meta, has_more: true, next_cursor: "opaque-first" } });
    });
    const api = createOperationsApiClient({ fetcher });
    const view = render(<DecisionCasesPage key="initial" api={api} apiMode="real" initialQuery={{ factory_id: "factory-1", limit: 1 }} />);
    await user.click(await screen.findByRole("button", { name: "Load more cases" }));
    expect(await screen.findByText("2 cases loaded")).toBeInTheDocument();
    expect(String(fetcher.mock.calls[1][0])).toContain("cursor=opaque-first");
    await user.selectOptions(screen.getByLabelText("Status"), "APPROVED");
    await user.selectOptions(screen.getByLabelText("Case mode"), "SIMULATION_ONLY");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    view.rerender(<DecisionCasesPage key="filtered" api={api} apiMode="real" initialQuery={{ factory_id: "factory-1", status: "APPROVED", mode: "SIMULATION_ONLY", limit: 1 }} />);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    const filtered = new URL(String(fetcher.mock.lastCall?.[0]), "http://localhost");
    expect(Object.fromEntries(filtered.searchParams)).toEqual({ factory_id: "factory-1", status: "APPROVED", mode: "SIMULATION_ONLY", limit: "1" });
    expect(replace).toHaveBeenCalledWith("/operations/cases?factory_id=factory-1&status=APPROVED&mode=SIMULATION_ONLY", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Refresh cases" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(String(fetcher.mock.lastCall?.[0])).not.toContain("cursor=");
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("waits for route commitment before reading a changed filter scope", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(caseListFixture()));
    const api = createOperationsApiClient({ fetcher });
    const view = render(<DecisionCasesPage key="initial-route" api={api} apiMode="real" initialQuery={{ factory_id: "factory-1" }} />);
    await screen.findByText("Stale basis");
    replace.mockClear();

    await user.selectOptions(screen.getByLabelText("Status"), "COMMITTED");
    await user.selectOptions(screen.getByLabelText("Case mode"), "LIVE");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(replace).toHaveBeenCalledWith("/operations/cases?factory_id=factory-1&status=COMMITTED&mode=LIVE", { scroll: false });
    // router.replace is asynchronous. Do not display filtered results while a
    // reload would still use the old URL. Model the RSC route committing below.
    expect(fetcher).toHaveBeenCalledTimes(1);

    view.rerender(<DecisionCasesPage key="committed-route" api={api} apiMode="real" initialQuery={{ factory_id: "factory-1", status: "COMMITTED", mode: "LIVE" }} />);
    await screen.findByText("Stale basis");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const applied = new URL(String(fetcher.mock.lastCall?.[0]), "http://localhost");
    expect(Object.fromEntries(applied.searchParams)).toEqual({ factory_id: "factory-1", status: "COMMITTED", mode: "LIVE", limit: "25" });
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("uses the mock adapter's same DTO path and shows an explicit empty state", async () => {
    const api = createMockOperationsApiClient();
    render(<DecisionCasesPage api={api} apiMode="mock" initialQuery={{ factory_id: "factory-demo-01" }} />);
    expect(await screen.findByText("No matching cases")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a case from Overview" })).toHaveAttribute("href", "/overview?factory_id=factory-demo-01&demo=1");
  });
  it("renders mock-created canonical cases through the same typed list component without changing status", async () => {
    const api = createMockOperationsApiClient();
    const context = await api.getOperationsSnapshot("factory-demo-01");
    const created = await api.createDecisionCase({ schema_version: "3.0", factory_id: context.factory_id,
      expected_snapshot_id: context.snapshot_id, expected_plan_version: context.plan_version,
      request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: "Discovery preview" }, planning_config: { horizon_minutes: 720 } } }, { idempotencyKey: "discovery-create" });
    render(<DecisionCasesPage api={api} apiMode="mock" initialQuery={{ factory_id: context.factory_id }} />);
    await screen.findByRole("link", { name: `Open recommendation for ${created.caseStatus.decision_case_id}` });
    expect(screen.getByText("CREATED", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Current basis")).toBeInTheDocument();
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect((await api.listDecisionCases({ factory_id: context.factory_id })).data[0].status).toBe("CREATED");
  });
  it.each([401, 403, 404, 503, 0])("shows %s read errors and retries without fixture rows", async status => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      if (!status) throw new TypeError("Network failed");
      return Response.json({ success: false }, { status });
    }).mockResolvedValue(Response.json(caseListFixture()));
    render(<DecisionCasesPage api={createOperationsApiClient({ fetcher })} apiMode="real" initialQuery={{ factory_id: "factory-1" }} />);
    await screen.findByRole("alert");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    if (status === 401 || status === 403) expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Stale basis")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("changes factory and discards the old cursor/data", async () => {
    const user = userEvent.setup();
    const page = caseListFixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page)).mockResolvedValue(Response.json({ ...page, data: [], meta: { ...page.meta, factory_id: "factory-2" } }));
    const api = createOperationsApiClient({ fetcher });
    const view = render(<DecisionCasesPage key="factory-1" api={api} initialQuery={{ factory_id: "factory-1" }} />);
    await screen.findByText("Stale basis");
    await user.clear(screen.getByLabelText("Factory ID"));
    await user.type(screen.getByLabelText("Factory ID"), "factory-2");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    view.rerender(<DecisionCasesPage key="factory-2" api={api} initialQuery={{ factory_id: "factory-2" }} />);
    await screen.findByText("No matching cases");
    expect(screen.queryByText("Stale basis")).not.toBeInTheDocument();
    expect(String(fetcher.mock.lastCall?.[0])).toContain("factory_id=factory-2");
  });
});
