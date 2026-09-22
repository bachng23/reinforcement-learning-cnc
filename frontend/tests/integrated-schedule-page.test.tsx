import type { ReactNode } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IntegratedSchedulePage } from "@/components/pages/integrated-schedule-page";
import { createOperationsApiClient } from "@/lib/operations-api/client";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";
import { createMockOperationsApiClient, type OperationsMockMode } from "@/lib/operations-api/mock";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/operations/schedule",
}));

const factoryId = createOperationsDemoFixtures().request.factory_snapshot.factory_id;

function ganttProjection() {
  return {
    lanes: screen.getAllByLabelText(/ lane$/).map((lane) => lane.getAttribute("aria-label")),
    assignments: screen.getAllByRole("row").slice(1).map((row) => row.textContent),
  };
}

describe("IntegratedSchedulePage API integration", () => {
  it("renders the canonical current schedule with context and all machine/technician lanes", async () => {
    render(<IntegratedSchedulePage api={createMockOperationsApiClient()} factoryId={factoryId} apiMode="mock" />);

    expect(screen.getByRole("heading", { name: "Loading current schedule" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Current committed schedule" })).toBeInTheDocument();

    const context = within(screen.getByLabelText("Schedule context"));
    expect(context.getByText("snapshot-demo-20260922-0800")).toBeInTheDocument();
    expect(context.getByText("schedule-demo-current")).toBeInTheDocument();
    expect(screen.getByText("Plan version").closest("article")).toHaveTextContent("1");
    expect(screen.getByText("Schedule revision").closest("article")).toHaveTextContent("1");
    expect(screen.getByText("Planning window").closest("article")).not.toHaveTextContent("Not provided");

    for (const resourceId of ["M01", "M02", "M03", "M04", "M05", "M06", "T01", "T02", "T03"]) {
      expect(screen.getByLabelText(`${resourceId} lane`)).toBeInTheDocument();
    }
    expect(screen.getAllByText("J01-O10").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Not provided/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Proposed recommended schedule/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Balanced candidate/i)).not.toBeInTheDocument();
  });

  it("gives the HTTP and mock adapters the same rendered Gantt input", async () => {
    const mock = createMockOperationsApiClient();
    const snapshot = await mock.getOperationsSnapshot(factoryId);
    const schedule = await mock.getCurrentSchedule(factoryId);
    const mockView = render(<IntegratedSchedulePage api={mock} factoryId={factoryId} apiMode="mock" />);
    await screen.findByRole("heading", { name: "Current committed schedule" });
    const mockProjection = ganttProjection();
    mockView.unmount();

    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      return Response.json({
        success: true,
        data: path.endsWith("/operations/snapshot") ? snapshot : schedule,
      });
    });
    const http = createOperationsApiClient({ fetcher, baseUrl: "https://example.test/api/v1" });
    render(<IntegratedSchedulePage api={http} factoryId={factoryId} apiMode="real" />);
    await screen.findByRole("heading", { name: "Current committed schedule" });

    expect(ganttProjection()).toEqual(mockProjection);
    expect(screen.getByRole("note")).toHaveTextContent("Live Operations API mode");
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/v1/operations/snapshot",
      "/api/v1/schedules/current",
    ]);
  });

  it("shows a snapshot with no current schedule without fabricating a plan", async () => {
    render(<IntegratedSchedulePage api={createMockOperationsApiClient({ mode: "empty-schedule" })} factoryId={factoryId} />);

    expect(await screen.findByRole("heading", { name: "No current schedule" })).toBeInTheDocument();
    expect(screen.getByText("Schedule ID").closest("article")).toHaveTextContent("Not provided");
    expect(screen.getByText("Schedule revision").closest("article")).toHaveTextContent("Not provided");
    expect(screen.queryByRole("heading", { name: "Current committed schedule" })).not.toBeInTheDocument();
    expect(screen.queryByText("J01-O10")).not.toBeInTheDocument();
  });

  it("shows an explicit empty-assignment state for a returned schedule", async () => {
    const source = createMockOperationsApiClient();
    const scheduleResponse = await source.getCurrentSchedule(factoryId);
    if (!scheduleResponse.schedule) throw new Error("Canonical schedule is required by this test.");
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getCurrentSchedule").mockResolvedValue({
      ...scheduleResponse,
      schedule: { ...scheduleResponse.schedule, assignments: [] },
    });

    render(<IntegratedSchedulePage api={api} factoryId={factoryId} />);

    expect(await screen.findByRole("heading", { name: "Current schedule has no assignments" })).toBeInTheDocument();
    expect(screen.getByText("schedule-demo-current")).toBeInTheDocument();
    expect(screen.queryByLabelText("M01 lane")).not.toBeInTheDocument();
  });

  it.each([
    ["unauthorized", "Schedule access required"],
    ["unavailable", "Operations snapshot unavailable"],
  ] as const)("shows the %s state without fixture schedule rows", async (mode: OperationsMockMode, heading) => {
    render(<IntegratedSchedulePage api={createMockOperationsApiClient({ mode })} factoryId={factoryId} apiMode="real" />);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText("J01-O10")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("M01 lane")).not.toBeInTheDocument();
  });

  it("retries both reads after a network failure", async () => {
    const user = userEvent.setup();
    const api = createMockOperationsApiClient();
    const readSnapshot = api.getOperationsSnapshot.bind(api);
    const getSnapshot = vi.spyOn(api, "getOperationsSnapshot")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(readSnapshot);
    const getSchedule = vi.spyOn(api, "getCurrentSchedule");
    render(<IntegratedSchedulePage api={api} factoryId={factoryId} apiMode="real" />);

    expect(await screen.findByRole("heading", { name: "Schedule data could not be loaded" })).toBeInTheDocument();
    expect(screen.getByText("Network error: Failed to fetch")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Current committed schedule" })).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(getSchedule).toHaveBeenCalledTimes(2);
  });

  it("does not render a schedule when snapshot ID or plan version differs", async () => {
    const api = createMockOperationsApiClient();
    const readSchedule = api.getCurrentSchedule.bind(api);
    vi.spyOn(api, "getCurrentSchedule").mockImplementation(async (...args) => {
      const response = await readSchedule(...args);
      return { ...response, snapshot_id: "newer-snapshot", plan_version: response.plan_version + 1 };
    });
    render(<IntegratedSchedulePage api={api} factoryId={factoryId} />);

    expect(await screen.findByRole("heading", { name: "Schedule version mismatch" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Current committed schedule" })).not.toBeInTheDocument();
    expect(screen.queryByText("J01-O10")).not.toBeInTheDocument();
  });

  it("filters machine lanes and reports an assignment type with no matches", async () => {
    const user = userEvent.setup();
    render(<IntegratedSchedulePage api={createMockOperationsApiClient()} factoryId={factoryId} />);
    await screen.findByRole("heading", { name: "Current committed schedule" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter schedule by machine" }), "M01");
    expect(screen.getByLabelText("M01 lane")).toBeInTheDocument();
    expect(screen.queryByLabelText("M02 lane")).not.toBeInTheDocument();
    expect(screen.getByLabelText("T01 lane")).toBeInTheDocument();
    expect(screen.queryByText("J02-O10")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter schedule by assignment type" }), "MAINTENANCE");
    await waitFor(() => expect(screen.getByText("No assignments match the selected filters.")).toBeInTheDocument());
    expect(screen.queryByText("J01-O10")).not.toBeInTheDocument();
  });
});
