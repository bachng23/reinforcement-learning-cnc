import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecommendationCenterPage } from "@/components/pages/recommendation-center-page";
import {
  OperationsApiError,
  type OperationsDecisionCaseMeta,
} from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import {
  createMockRecommendationCenterDataSource,
  createRealRecommendationCenterDataSource,
  type RecommendationCenterDataSource,
  type RecommendationCenterPreviewData,
} from "@/lib/recommendation-center";
import type { DecisionCaseStatusResponse } from "@/types/generated/operations";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/operations/recommendations",
}));

async function canonicalPreview(): Promise<RecommendationCenterPreviewData> {
  const source = createMockRecommendationCenterDataSource();
  const data = await source.read(source.defaultCaseId ?? "");
  if (data.source !== "mock") throw new Error("Expected canonical preview data.");
  return data;
}

function caseMeta(attempt = 1, errorCode: string | null = null): OperationsDecisionCaseMeta {
  return {
    factory_id: "factory-north",
    base_plan_version: 7,
    case_revision: 2,
    current_context: { snapshot_id: "snapshot-current", plan_version: 8 },
    stale: true,
    processing: {
      status: errorCode ? "FAILED" : "RUNNING",
      attempt,
      error_code: errorCode,
    },
  };
}

function liveStatus(
  preview: RecommendationCenterPreviewData,
  status: DecisionCaseStatusResponse["status"],
  overrides: Partial<DecisionCaseStatusResponse> = {},
): DecisionCaseStatusResponse {
  return {
    schema_version: "3.0",
    decision_case_id: preview.recommendation.decision_case_id,
    mode: "LIVE",
    status,
    snapshot_id: preview.snapshot.snapshot_id,
    created_at: "2026-09-25T00:00:00Z",
    updated_at: "2026-09-25T00:01:00Z",
    recommendation_id: status === "AWAITING_APPROVAL" ? preview.recommendation.recommendation_id : null,
    committed_schedule_id: null,
    error_code: null,
    ...overrides,
  };
}

function apiFailure(status: number, message: string, code = `STATUS_${status}`) {
  return new OperationsApiError(status, {
    schema_version: "3.0",
    error_id: `recommendation-${status}`,
    code,
    message,
    correlation_id: `recommendation-request-${status}`,
    retryable: status === 503,
    details: [],
  });
}

describe("RecommendationCenterPage live integration", () => {
  it("renders the canonical recommendation and preview-only controls in mock mode", async () => {
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

  it("fails closed and hides controls when a preview package and snapshot mismatch", async () => {
    const canonical = await canonicalPreview();
    const mismatched = structuredClone(canonical);
    mismatched.snapshot.snapshot_id = "snapshot-authoritative-newer";
    const dataSource: RecommendationCenterDataSource = {
      mode: "mock",
      defaultCaseId: canonical.caseStatus.decision_case_id,
      read: vi.fn().mockResolvedValue(mismatched),
    };

    render(<RecommendationCenterPage dataSource={dataSource} />);

    expect(await screen.findByRole("heading", { name: "Recommendation package mismatch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("renders a ready live package with its immutable basis snapshot and no write controls", async () => {
    const preview = await canonicalPreview();
    const status = liveStatus(preview, "AWAITING_APPROVAL");
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: status, meta: caseMeta(2) });
    const recommendationRead = vi.spyOn(api, "getDecisionCaseRecommendation").mockResolvedValue({
      recommendation: preview.recommendation,
      snapshot: preview.snapshot,
    });
    const currentSnapshotRead = vi.spyOn(api, "getOperationsSnapshot");

    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId={status.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Candidate comparison" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Decision case status" })).toBeInTheDocument();
    expect(screen.getByText("Attempt").parentElement).toHaveTextContent("2");
    expect(screen.getAllByText(preview.snapshot.snapshot_id).length).toBeGreaterThan(0);
    expect(recommendationRead).toHaveBeenCalledWith(status.decision_case_id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(currentSnapshotRead).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("shows stage and attempt while a live case is polling without fixture candidates", async () => {
    const preview = await canonicalPreview();
    const status = liveStatus(preview, "VALIDATING");
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: status, meta: caseMeta(3) });
    const recommendationRead = vi.spyOn(api, "getDecisionCaseRecommendation");

    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId={status.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Planning recommendation" })).toBeInTheDocument();
    expect(screen.getByText("Stage").parentElement).toHaveTextContent("VALIDATING");
    expect(screen.getByText("Attempt").parentElement).toHaveTextContent("3");
    expect(recommendationRead).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
    expect(screen.queryByText(/PRODUCTION PRIORITY/)).not.toBeInTheDocument();
  });

  it("treats RECOMMENDATION_NOT_READY as pending without fixture fallback", async () => {
    const preview = await canonicalPreview();
    const status = liveStatus(preview, "AWAITING_APPROVAL");
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: status, meta: caseMeta(2) });
    vi.spyOn(api, "getDecisionCaseRecommendation").mockRejectedValue(
      apiFailure(404, "Recommendation is not ready", "RECOMMENDATION_NOT_READY"),
    );

    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId={status.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Recommendation is not ready" })).toBeInTheDocument();
    expect(screen.getByText(/No fixture data is shown in live mode/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
  });

  it.each([
    ["NO_FEASIBLE_PLAN", "No feasible recommendation"],
    ["PLANNING_TIMEOUT", "Recommendation planning timed out"],
  ] as const)("renders the safe blocked state for %s and stops before artifact read", async (errorCode, title) => {
    const preview = await canonicalPreview();
    const status = liveStatus(preview, "FAILED", { error_code: errorCode });
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: status, meta: caseMeta(4, errorCode) });
    const recommendationRead = vi.spyOn(api, "getDecisionCaseRecommendation");

    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId={status.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText("Attempt").parentElement).toHaveTextContent("4");
    expect(screen.getByText(errorCode)).toBeInTheDocument();
    expect(recommendationRead).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
  });

  it("fails closed when the live artifact identifiers mismatch", async () => {
    const preview = await canonicalPreview();
    const status = liveStatus(preview, "AWAITING_APPROVAL");
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: status, meta: caseMeta() });
    vi.spyOn(api, "getDecisionCaseRecommendation").mockResolvedValue({
      recommendation: { ...preview.recommendation, recommendation_id: "recommendation-wrong" },
      snapshot: preview.snapshot,
    });

    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId={status.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Recommendation context mismatch" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
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

  it("retries the live status read after an error", async () => {
    const user = userEvent.setup();
    const preview = await canonicalPreview();
    const status = liveStatus(preview, "VALIDATING");
    const api = createMockOperationsApiClient();
    const getDecisionCase = vi.spyOn(api, "getDecisionCase")
      .mockRejectedValueOnce(apiFailure(503, "Temporarily unavailable"))
      .mockResolvedValue({ caseStatus: status, meta: caseMeta(2) });
    render(<RecommendationCenterPage dataSource={createRealRecommendationCenterDataSource(api)} caseId={status.decision_case_id} />);

    expect(await screen.findByRole("heading", { name: "Recommendation service unavailable" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry case" }));

    expect(await screen.findByRole("heading", { name: "Planning recommendation" })).toBeInTheDocument();
    expect(getDecisionCase).toHaveBeenCalledTimes(2);
  });
});
