// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  OperationsApiError,
  type OperationsDecisionCaseMeta,
  type OperationsDecisionCaseProcessing,
} from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import {
  createMockRecommendationCenterDataSource,
  createRealRecommendationCenterDataSource,
  type RecommendationCenterPreviewData,
} from "@/lib/recommendation-center";
import type { DecisionCaseStatusResponse } from "@/types/generated/operations";

async function canonicalPreview(): Promise<RecommendationCenterPreviewData> {
  const source = createMockRecommendationCenterDataSource();
  const data = await source.read(source.defaultCaseId ?? "");
  if (data.source !== "mock") throw new Error("Expected canonical recommendation preview.");
  return data;
}

function meta(attempt: number, status: OperationsDecisionCaseProcessing = {
  status: "RUNNING",
  attempt,
  error_code: null,
}): OperationsDecisionCaseMeta {
  return {
    factory_id: "factory-north",
    base_plan_version: 7,
    case_revision: 3,
    current_context: { snapshot_id: "current-snapshot-that-must-not-be-used", plan_version: 9 },
    stale: true,
    processing: status,
  };
}

function statusFor(
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

function notReadyError() {
  return new OperationsApiError(404, {
    success: false,
    error: { code: "RECOMMENDATION_NOT_READY", message: "Recommendation is not ready" },
    request_id: "request-not-ready",
  });
}

describe("real Recommendation Center data source", () => {
  it("reads status first and renders the package with its returned immutable basis snapshot", async () => {
    const preview = await canonicalPreview();
    const api = createMockOperationsApiClient();
    const calls: string[] = [];
    vi.spyOn(api, "getDecisionCase").mockImplementation(async () => {
      calls.push("status");
      return { caseStatus: statusFor(preview, "AWAITING_APPROVAL"), meta: meta(2, { status: "SUCCEEDED", attempt: 2, error_code: null }) };
    });
    vi.spyOn(api, "getDecisionCaseRecommendation").mockImplementation(async () => {
      calls.push("recommendation");
      return { recommendation: preview.recommendation, snapshot: preview.snapshot };
    });
    const currentSnapshot = vi.spyOn(api, "getOperationsSnapshot");

    const data = await createRealRecommendationCenterDataSource(api).read(preview.recommendation.decision_case_id);

    expect(calls).toEqual(["status", "recommendation"]);
    expect(data).toMatchObject({ source: "real", artifactState: "ready" });
    if (data.source !== "real" || data.artifactState !== "ready") throw new Error("Expected ready live data.");
    expect(data.recommendation).toBe(preview.recommendation);
    expect(data.snapshot).toBe(preview.snapshot);
    expect(data.snapshot.snapshot_id).not.toBe(data.caseMeta?.current_context?.snapshot_id);
    expect(currentSnapshot).not.toHaveBeenCalled();
  });

  it("keeps running stages pending without requesting an artifact", async () => {
    const preview = await canonicalPreview();
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: statusFor(preview, "VALIDATING"), meta: meta(3) });
    const recommendation = vi.spyOn(api, "getDecisionCaseRecommendation");

    await expect(createRealRecommendationCenterDataSource(api).read(preview.recommendation.decision_case_id))
      .resolves.toMatchObject({ source: "real", artifactState: "pending", recommendation: null, snapshot: null });
    expect(recommendation).not.toHaveBeenCalled();
  });

  it("treats RECOMMENDATION_NOT_READY as pending and never falls back to the fixture", async () => {
    const preview = await canonicalPreview();
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: statusFor(preview, "AWAITING_APPROVAL"), meta: meta(1) });
    vi.spyOn(api, "getDecisionCaseRecommendation").mockRejectedValue(notReadyError());

    const data = await createRealRecommendationCenterDataSource(api).read(preview.recommendation.decision_case_id);

    expect(data).toMatchObject({ source: "real", artifactState: "pending", recommendation: null, snapshot: null });
    expect(data).not.toHaveProperty("modifiedSchedule");
  });

  it("returns a blocked state with safe attempt metadata for failed planning", async () => {
    const preview = await canonicalPreview();
    const api = createMockOperationsApiClient();
    const failed = statusFor(preview, "FAILED", { error_code: "NO_FEASIBLE_PLAN", recommendation_id: null });
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({
      caseStatus: failed,
      meta: meta(4, { status: "FAILED", attempt: 4, error_code: "NO_FEASIBLE_PLAN" }),
    });
    const recommendation = vi.spyOn(api, "getDecisionCaseRecommendation");

    await expect(createRealRecommendationCenterDataSource(api).read(preview.recommendation.decision_case_id))
      .resolves.toMatchObject({ source: "real", artifactState: "blocked", caseStatus: { error_code: "NO_FEASIBLE_PLAN" } });
    expect(recommendation).not.toHaveBeenCalled();
  });

  it.each([
    ["case ID", (preview: RecommendationCenterPreviewData, status: DecisionCaseStatusResponse) => ({ status: { ...status, decision_case_id: "different-case" }, recommendation: preview.recommendation, snapshot: preview.snapshot })],
    ["package case ID", (preview: RecommendationCenterPreviewData, status: DecisionCaseStatusResponse) => ({ status, recommendation: { ...preview.recommendation, decision_case_id: "different-case" }, snapshot: preview.snapshot })],
    ["package snapshot ID", (preview: RecommendationCenterPreviewData, status: DecisionCaseStatusResponse) => ({ status, recommendation: { ...preview.recommendation, snapshot_id: "different-snapshot" }, snapshot: preview.snapshot })],
    ["basis snapshot ID", (preview: RecommendationCenterPreviewData, status: DecisionCaseStatusResponse) => ({ status, recommendation: preview.recommendation, snapshot: { ...preview.snapshot, snapshot_id: "different-snapshot" } })],
    ["recommendation ID", (preview: RecommendationCenterPreviewData, status: DecisionCaseStatusResponse) => ({ status, recommendation: { ...preview.recommendation, recommendation_id: "different-recommendation" }, snapshot: preview.snapshot })],
  ])("fails closed on %s mismatch", async (_label, arrange) => {
    const preview = await canonicalPreview();
    const expectedStatus = statusFor(preview, "AWAITING_APPROVAL");
    const arranged = arrange(preview, expectedStatus);
    const api = createMockOperationsApiClient();
    vi.spyOn(api, "getDecisionCase").mockResolvedValue({ caseStatus: arranged.status, meta: meta(1) });
    const recommendation = vi.spyOn(api, "getDecisionCaseRecommendation").mockResolvedValue({
      recommendation: arranged.recommendation,
      snapshot: arranged.snapshot,
    });

    const data = await createRealRecommendationCenterDataSource(api).read(preview.recommendation.decision_case_id);

    expect(data).toMatchObject({ source: "real", artifactState: "mismatch", recommendation: null, snapshot: null });
    if (arranged.status.decision_case_id !== preview.recommendation.decision_case_id) {
      expect(recommendation).not.toHaveBeenCalled();
    }
  });
});
