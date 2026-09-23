import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecommendationCenterPage } from "@/components/pages/recommendation-center-page";
import { OperationsApiError } from "@/lib/operations-api/client";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import {
  createMockRecommendationCenterDataSource,
  createRealRecommendationCenterDataSource,
  type RecommendationCenterDataSource,
} from "@/lib/recommendation-center";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/operations/recommendations",
}));

const caseStatus = createOperationsDemoFixtures().status;

function apiFailure(status: number, message: string) {
  return new OperationsApiError(status, {
    schema_version: "3.0",
    error_id: `recommendation-${status}`,
    code: `STATUS_${status}`,
    message,
    correlation_id: `recommendation-request-${status}`,
    retryable: status === 503,
    details: [],
  });
}

function realSourceWithCase() {
  const api = createMockOperationsApiClient();
  const getDecisionCase = vi.spyOn(api, "getDecisionCase").mockResolvedValue(caseStatus);
  return { api, getDecisionCase, dataSource: createRealRecommendationCenterDataSource(api) };
}

describe("RecommendationCenterPage data integration", () => {
  it("renders the canonical recommendation and preview-only decision controls in mock mode", async () => {
    const user = userEvent.setup();
    render(<RecommendationCenterPage dataSource={createMockRecommendationCenterDataSource()} />);

    expect(screen.getByRole("heading", { name: "Loading decision case" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Candidate comparison" })).toBeInTheDocument();
    expect(screen.getByText("Every value below comes directly", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why this recommendation?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();

    const production = screen.getByRole("button", { name: /PRODUCTION PRIORITY/ });
    await user.click(production);
    expect(production).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/M01 retains elevated failure probability before intervention/)).toBeInTheDocument();
  });

  it("fails closed and hides decision controls when the preview package and snapshot mismatch", async () => {
    const canonicalSource = createMockRecommendationCenterDataSource();
    const canonical = await canonicalSource.read(canonicalSource.defaultCaseId ?? "");
    if (canonical.source !== "mock") throw new Error("Expected mock preview data.");
    const mismatched = structuredClone(canonical);
    mismatched.snapshot.snapshot_id = "snapshot-authoritative-newer";
    const dataSource: RecommendationCenterDataSource = {
      mode: "mock",
      defaultCaseId: canonicalSource.defaultCaseId,
      read: vi.fn().mockResolvedValue(mismatched),
    };

    render(<RecommendationCenterPage dataSource={dataSource} />);

    expect(await screen.findByRole("heading", { name: "Recommendation package mismatch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("renders authoritative real case status without fixture candidates", async () => {
    const { dataSource, getDecisionCase } = realSourceWithCase();
    render(<RecommendationCenterPage dataSource={dataSource} caseId={caseStatus.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Decision case status" })).toBeInTheDocument();
    expect(screen.getByText(caseStatus.decision_case_id)).toBeInTheDocument();
    expect(screen.getByText(caseStatus.snapshot_id)).toBeInTheDocument();
    expect(getDecisionCase).toHaveBeenCalledWith(
      caseStatus.decision_case_id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
    expect(screen.queryByText(/PRODUCTION PRIORITY/)).not.toBeInTheDocument();
  });

  it("does not synthesize plans, KPIs, evidence, schedules or decision controls when the package is unavailable", async () => {
    const { dataSource } = realSourceWithCase();
    render(<RecommendationCenterPage dataSource={dataSource} caseId={caseStatus.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Recommendation package not available" })).toBeInTheDocument();
    expect(screen.getByText(/returns status only/)).toBeInTheDocument();
    expect(screen.queryByText("Every value below comes directly", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Evidence:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("requires a case ID in real mode without issuing a request", async () => {
    const api = createMockOperationsApiClient();
    const getDecisionCase = vi.spyOn(api, "getDecisionCase");
    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} />);

    expect(await screen.findByRole("heading", { name: "Decision case ID required" })).toBeInTheDocument();
    expect(screen.getByText(/\?caseId=/)).toBeInTheDocument();
    expect(getDecisionCase).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Recommendation access required"],
    [403, "Recommendation access required"],
    [404, "Decision case not found"],
    [409, "Decision case changed"],
    [503, "Recommendation service unavailable"],
  ] as const)("renders HTTP %s without falling back to preview data", async (status, title) => {
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockRejectedValue(apiFailure(status, `Backend status ${status}`));
    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId="case-real" />);

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(`Backend status ${status}`)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Move O-17 from M01 to M04/)).not.toBeInTheDocument();
  });

  it("shows a network error without fixture fallback", async () => {
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId="case-real" />);

    expect(await screen.findByRole("heading", { name: "Recommendation data could not be loaded" })).toBeInTheDocument();
    expect(screen.getByText("Network error: Failed to fetch")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
  });

  it("retries the real case read after an error", async () => {
    const user = userEvent.setup();
    const api = createMockOperationsApiClient();
    const getDecisionCase = vi.spyOn(api, "getDecisionCase")
      .mockRejectedValueOnce(apiFailure(503, "Temporarily unavailable"))
      .mockResolvedValue(caseStatus);
    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId={caseStatus.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Recommendation service unavailable" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry case" }));

    expect(await screen.findByRole("heading", { name: "Recommendation package not available" })).toBeInTheDocument();
    expect(getDecisionCase).toHaveBeenCalledTimes(2);
  });
});
