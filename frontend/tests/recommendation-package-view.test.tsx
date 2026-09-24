import { useState } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  RecommendationPackageView,
  candidateRejectionReason,
} from "@/components/operations/recommendation-package-view";
import {
  createMockRecommendationCenterDataSource,
  type RecommendationCenterPreviewData,
} from "@/lib/recommendation-center";
import type {
  CandidatePlan,
  FactorySnapshot,
  RecommendationPackage,
} from "@/types/generated/operations";

async function canonicalPreview(): Promise<RecommendationCenterPreviewData> {
  const source = createMockRecommendationCenterDataSource();
  const data = await source.read(source.defaultCaseId ?? "");
  if (data.source !== "mock") throw new Error("Expected canonical mock recommendation data.");
  return data;
}

function packageWithCandidates(
  source: RecommendationPackage,
  candidates: [CandidatePlan, ...CandidatePlan[]],
  recommendedPlanId = candidates[0].candidate_plan_id,
): RecommendationPackage {
  return {
    ...structuredClone(source),
    recommended_plan_id: recommendedPlanId,
    candidate_plans: structuredClone(candidates),
  };
}

function SelectionHarness({
  recommendation,
  snapshot,
}: {
  recommendation: RecommendationPackage;
  snapshot: FactorySnapshot;
}) {
  const [selectedCandidateId, setSelectedCandidateId] = useState(recommendation.recommended_plan_id);
  return (
    <RecommendationPackageView
      recommendation={recommendation}
      snapshot={snapshot}
      selectedCandidateId={selectedCandidateId}
      onSelectCandidate={setSelectedCandidateId}
    />
  );
}

describe("RecommendationPackageView", () => {
  it("renders a one-candidate package and every KPI returned by the generated contract", async () => {
    const data = await canonicalPreview();
    const candidate = structuredClone(data.recommendation.candidate_plans[0]);
    candidate.kpis = {
      makespan_minutes: 777,
      total_tardiness_minutes: 123,
      maximum_tardiness_minutes: 45,
      on_time_completion_rate: 0.432,
      expected_failure_count: 6.7,
      failure_probability: 0.321,
      expected_emergency_downtime_minutes: 89,
      maintenance_cost: 6543,
      technician_utilization: 0.876,
      schedule_changes: 19,
      decision_latency_ms: null,
    };
    const recommendation = packageWithCandidates(data.recommendation, [candidate]);

    render(
      <RecommendationPackageView
        recommendation={recommendation}
        snapshot={data.snapshot}
        selectedCandidateId={candidate.candidate_plan_id}
        onSelectCandidate={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: new RegExp(candidate.candidate_plan_id) })).toHaveLength(1);
    expect(screen.getByText("RECOMMENDED")).toBeInTheDocument();
    [
      "Makespan",
      "Total tardiness",
      "Maximum tardiness",
      "On-time completion",
      "Expected failure count",
      "Failure probability",
      "Expected emergency downtime",
      "Maintenance cost",
      "Technician utilization",
      "Schedule changes",
      "Decision latency",
    ].forEach((label) => expect(screen.getByRole("row", { name: new RegExp(label) })).toBeInTheDocument());
    expect(screen.getByRole("row", { name: /Makespan/ })).toHaveTextContent("777 min");
    expect(screen.getByRole("row", { name: /Failure probability/ })).toHaveTextContent("32.1%");
    expect(screen.getByRole("row", { name: /Maintenance cost/ })).toHaveTextContent("6,543");
    expect(screen.getByRole("row", { name: /Decision latency/ })).toHaveTextContent("Not provided");
    const provenance = screen.getByRole("heading", { name: "Selected candidate provenance" }).closest("section");
    expect(within(provenance!).getByText(`${candidate.source_engine_id}@${candidate.source_engine_version}`)).toBeInTheDocument();
    const validation = screen.getByRole("heading", { name: "Validation" }).closest("section");
    expect(within(validation!).getByText(candidate.validation?.validator_version ?? "missing validator")).toBeInTheDocument();
    expect(within(validation!).getByText(String(candidate.validation?.simulation_runs))).toBeInTheDocument();
  });

  it("supports five candidates and keeps selection, KPI provenance and Gantt synchronized", async () => {
    const data = await canonicalPreview();
    const originals = data.recommendation.candidate_plans;
    const fourth = structuredClone(originals[0]);
    fourth.candidate_plan_id = "plan-fourth-contract-candidate";
    fourth.strategy = "CURRENT";
    fourth.validation!.candidate_plan_id = fourth.candidate_plan_id;
    fourth.schedule.schedule_id = "schedule-fourth";
    const fifth = structuredClone(originals[0]);
    fifth.candidate_plan_id = "plan-fifth-contract-candidate";
    fifth.strategy = "EXPERIMENTAL";
    fifth.validation!.candidate_plan_id = fifth.candidate_plan_id;
    fifth.schedule.schedule_id = "schedule-fifth";
    const recommendation = packageWithCandidates(data.recommendation, [
      originals[0],
      originals[1],
      originals[2],
      fourth,
      fifth,
    ]);
    const selected = originals[1];
    const user = userEvent.setup();

    render(<SelectionHarness recommendation={recommendation} snapshot={data.snapshot} />);
    expect(screen.getAllByRole("button", { name: /plan-/ })).toHaveLength(5);

    const selectionButton = screen.getByRole("button", { name: new RegExp(selected.candidate_plan_id) });
    await user.click(selectionButton);

    expect(selectionButton).toHaveAttribute("aria-pressed", "true");
    const provenance = screen.getByRole("heading", { name: "Selected candidate provenance" }).closest("section");
    expect(provenance).not.toBeNull();
    expect(within(provenance!).getByText(selected.candidate_plan_id)).toBeInTheDocument();
    expect(within(provenance!).getByText(new RegExp(selected.source_engine_id))).toBeInTheDocument();

    const makespanCells = within(screen.getByRole("row", { name: /Makespan/ })).getAllByRole("cell");
    expect(makespanCells[1]).toHaveAttribute("data-selected", "true");
    expect(makespanCells[1]).toHaveTextContent(String(selected.kpis.makespan_minutes));

    const gantt = screen.getByRole("heading", { name: "Selected candidate Gantt" }).closest("section");
    expect(gantt).not.toBeNull();
    expect(within(gantt!).getByRole("heading", { level: 3, name: `${selected.strategy} · ${selected.candidate_plan_id}` })).toBeInTheDocument();
    expect(within(gantt!).getByText(selected.schedule.schedule_id, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(selected.warnings?.[0] ?? "missing warning"))).toBeInTheDocument();
  });

  it("renders absent optional assumptions and warnings without inventing content", async () => {
    const data = await canonicalPreview();
    const candidate = structuredClone(data.recommendation.candidate_plans[0]);
    delete candidate.assumptions;
    delete candidate.warnings;
    const recommendation = packageWithCandidates(data.recommendation, [candidate]);

    render(<SelectionHarness recommendation={recommendation} snapshot={data.snapshot} />);

    const assumptions = screen.getByRole("heading", { name: "Assumptions" }).closest("section");
    const warnings = screen.getByRole("heading", { name: "Warnings" }).closest("section");
    expect(within(assumptions!).getByText("None returned")).toBeInTheDocument();
    expect(within(warnings!).getByText("None returned")).toBeInTheDocument();
  });

  it("wraps long candidate IDs and evidence references inside responsive scroll containers", async () => {
    const data = await canonicalPreview();
    const longId = `plan-${"candidate-segment-".repeat(12)}`;
    const longEvidence = `evidence://${"authoritative-reference/".repeat(12)}`;
    const candidate = structuredClone(data.recommendation.candidate_plans[0]);
    candidate.candidate_plan_id = longId;
    candidate.validation!.candidate_plan_id = longId;
    const recommendation = packageWithCandidates(data.recommendation, [candidate]);
    recommendation.explanation.evidence_refs = [longEvidence];

    render(<SelectionHarness recommendation={recommendation} snapshot={data.snapshot} />);

    expect(screen.getAllByText(longId)[0]).toHaveClass("break-all");
    expect(screen.getByText(longEvidence)).toHaveClass("break-all", "max-w-full");
    expect(screen.getByTestId("candidate-kpi-scroll")).toHaveClass("overflow-x-auto");
  });

  it("shows an explicit empty state when the selected schedule has no assignments", async () => {
    const data = await canonicalPreview();
    const candidate = structuredClone(data.recommendation.candidate_plans[0]);
    candidate.schedule.assignments = [];
    const recommendation = packageWithCandidates(data.recommendation, [candidate]);

    render(<SelectionHarness recommendation={recommendation} snapshot={data.snapshot} />);

    expect(screen.getByRole("heading", { name: "Selected candidate has no assignments" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/lane$/)).not.toBeInTheDocument();
  });

  it("fails closed when the package and authoritative snapshot do not match", async () => {
    const data = await canonicalPreview();
    const snapshot = { ...data.snapshot, snapshot_id: "snapshot-authoritative-newer" };

    render(
      <RecommendationPackageView
        recommendation={data.recommendation}
        snapshot={snapshot}
        selectedCandidateId={data.recommendation.recommended_plan_id}
        onSelectCandidate={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Recommendation package mismatch" })).toBeInTheDocument();
    expect(screen.getByText(/Candidate data is hidden/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Candidate comparison" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Selected candidate Gantt" })).not.toBeInTheDocument();
  });

  it("rejects missing or non-VALID validation and never exposes those candidates as selectable", async () => {
    const data = await canonicalPreview();
    const valid = structuredClone(data.recommendation.candidate_plans[0]);
    const missing = structuredClone(data.recommendation.candidate_plans[1]);
    missing.validation = null;
    const invalid = structuredClone(data.recommendation.candidate_plans[2]);
    invalid.validation!.verdict = "INVALID";
    const recommendation = packageWithCandidates(data.recommendation, [valid, missing, invalid]);

    expect(candidateRejectionReason(missing, recommendation, data.snapshot)).toBe("Validation payload is missing.");
    expect(candidateRejectionReason(invalid, recommendation, data.snapshot)).toBe("Validation verdict is INVALID.");
    render(<SelectionHarness recommendation={recommendation} snapshot={data.snapshot} />);

    expect(screen.getAllByRole("button", { name: /plan-/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: new RegExp(missing.candidate_plan_id) })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(invalid.candidate_plan_id) })).not.toBeInTheDocument();
    const rejected = screen.getByRole("region", { name: "Rejected candidates" });
    expect(rejected).toHaveTextContent(missing.candidate_plan_id);
    expect(rejected).toHaveTextContent("Validation payload is missing");
    expect(rejected).toHaveTextContent(invalid.candidate_plan_id);
    expect(rejected).toHaveTextContent("Validation verdict is INVALID");
  });

  it("hides the entire package when the recommended candidate itself is invalid", async () => {
    const data = await canonicalPreview();
    const candidate = structuredClone(data.recommendation.candidate_plans[0]);
    candidate.validation!.verdict = "ERROR";
    const recommendation = packageWithCandidates(data.recommendation, [candidate]);

    render(<SelectionHarness recommendation={recommendation} snapshot={data.snapshot} />);

    expect(screen.getByRole("heading", { name: "Recommendation package mismatch" })).toBeInTheDocument();
    expect(screen.getByText(/recommended candidate was rejected/i)).toBeInTheDocument();
    expect(screen.queryByText("RECOMMENDED")).not.toBeInTheDocument();
  });
});
