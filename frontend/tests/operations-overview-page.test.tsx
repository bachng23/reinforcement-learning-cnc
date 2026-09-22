import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OperationsOverviewPage } from "@/components/pages/operations-overview-page";
import { createOperationsApiClient, OperationsApiError, type OperationsCurrentScheduleResponse, type OperationsSnapshotResponse } from "@/lib/operations-api/client";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { deferred } from "@/tests/product-api-test-utils";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/operations",
}));

const factoryId = createOperationsDemoFixtures().request.factory_snapshot.factory_id;

describe("OperationsOverviewPage API integration", () => {
  it("loads canonical 6-machine, 12-job and 3-technician data through both mock reads", async () => {
    const api = createMockOperationsApiClient();
    const getSnapshot = vi.spyOn(api, "getOperationsSnapshot");
    const getSchedule = vi.spyOn(api, "getCurrentSchedule");

    render(<OperationsOverviewPage api={api} factoryId={factoryId} apiMode="mock" />);

    expect(screen.getByRole("heading", { name: "Loading operations snapshot" })).toBeInTheDocument();
    expect(await screen.findByLabelText("6 machines")).toBeInTheDocument();
    expect(screen.getByLabelText("12 jobs")).toBeInTheDocument();
    expect(screen.getByLabelText("3 technicians")).toBeInTheDocument();
    expect(screen.getByText("J12")).toBeInTheDocument();
    expect(screen.getByText("CNC M06")).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenCalledWith(factoryId, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(getSchedule).toHaveBeenCalledWith(factoryId, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("renders the same page through the real HTTP adapter without a fixture-mode notice", async () => {
    const mock = createMockOperationsApiClient();
    const snapshot = await mock.getOperationsSnapshot(factoryId);
    const schedule = await mock.getCurrentSchedule(factoryId);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const data = url.pathname.endsWith("/operations/snapshot") ? snapshot : schedule;
      return Response.json({ success: true, data });
    });
    const api = createOperationsApiClient({ fetcher, baseUrl: "https://example.test/api/v1" });

    render(<OperationsOverviewPage api={api} factoryId={factoryId} apiMode="real" />);

    expect(await screen.findByLabelText("12 jobs")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Live Operations API mode");
    expect(screen.queryByText(/Fixture mode uses/)).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/v1/operations/snapshot",
      "/api/v1/schedules/current",
    ]);
  });

  it("keeps loading visible until both API reads complete", async () => {
    const snapshot = deferred<OperationsSnapshotResponse>();
    const schedule = deferred<OperationsCurrentScheduleResponse>();
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getOperationsSnapshot").mockReturnValue(snapshot.promise);
    vi.spyOn(api, "getCurrentSchedule").mockReturnValue(schedule.promise);

    render(<OperationsOverviewPage api={api} factoryId={factoryId} />);
    expect(screen.getByRole("heading", { name: "Loading operations snapshot" })).toBeInTheDocument();

    const success = createMockOperationsApiClient();
    snapshot.resolve(await success.getOperationsSnapshot(factoryId));
    expect(screen.getByRole("heading", { name: "Loading operations snapshot" })).toBeInTheDocument();
    schedule.resolve(await success.getCurrentSchedule(factoryId));
    expect(await screen.findByRole("heading", { name: "Machine status grid" })).toBeInTheDocument();
  });

  it("shows empty resource and empty current-schedule states without fabricating data", async () => {
    const source = createMockOperationsApiClient({ mode: "empty-schedule" });
    const snapshot = await source.getOperationsSnapshot(factoryId);
    const schedule = await source.getCurrentSchedule(factoryId);
    const emptyApi = createMockOperationsApiClient();
    vi.spyOn(emptyApi, "getOperationsSnapshot").mockResolvedValue({
      ...snapshot,
      snapshot: {
        ...snapshot.snapshot,
        machines: [] as unknown as typeof snapshot.snapshot.machines,
        jobs: [],
        technicians: [],
      },
    });
    vi.spyOn(emptyApi, "getCurrentSchedule").mockResolvedValue(schedule);
    const emptyView = render(<OperationsOverviewPage api={emptyApi} factoryId={factoryId} />);

    expect(await screen.findByRole("heading", { name: "No operations resources" })).toBeInTheDocument();
    expect(screen.queryByText("CNC M01")).not.toBeInTheDocument();
    emptyView.unmount();

    render(<OperationsOverviewPage api={source} factoryId={factoryId} />);
    expect(await screen.findByRole("heading", { name: "No current schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText("6 machines")).toBeInTheDocument();
  });

  it("shows an unauthorized state without falling back to fixture rows", async () => {
    render(<OperationsOverviewPage api={createMockOperationsApiClient({ mode: "unauthorized" })} factoryId={factoryId} apiMode="real" />);

    expect(await screen.findByRole("heading", { name: "Operations access required" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByText("CNC M01")).not.toBeInTheDocument();
  });

  it("shows snapshot-unavailable and retries both reads on explicit user action", async () => {
    const user = userEvent.setup();
    const api = createMockOperationsApiClient();
    const originalSnapshot = api.getOperationsSnapshot.bind(api);
    const getSnapshot = vi.spyOn(api, "getOperationsSnapshot")
      .mockRejectedValueOnce(new OperationsApiError(503, {
        schema_version: "3.0",
        error_id: "test-error",
        code: "DB_UNAVAILABLE",
        message: "Operations context is unavailable",
        correlation_id: "test-request",
        retryable: true,
        details: [],
      }))
      .mockImplementation(originalSnapshot);
    const getSchedule = vi.spyOn(api, "getCurrentSchedule");

    render(<OperationsOverviewPage api={api} factoryId={factoryId} />);
    expect(await screen.findByRole("heading", { name: "Operations snapshot unavailable" })).toBeInTheDocument();
    expect(screen.queryByText("CNC M01")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry snapshot" }));
    expect(await screen.findByRole("heading", { name: "Machine status grid" })).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(getSchedule).toHaveBeenCalledTimes(2);
  });

  it("surfaces network failures with retry and never injects mock data", async () => {
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getOperationsSnapshot").mockRejectedValue(new TypeError("Failed to fetch"));

    render(<OperationsOverviewPage api={api} factoryId={factoryId} apiMode="real" />);

    expect(await screen.findByRole("heading", { name: "Operations data could not be loaded" })).toBeInTheDocument();
    expect(screen.getByText("Network error: Failed to fetch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("CNC M01")).not.toBeInTheDocument();
  });
});
