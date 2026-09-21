"use client";

import { FileJson2, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { CandidateComparison } from "@/components/operations/candidate-comparison";
import { DecisionControls } from "@/components/operations/decision-controls";
import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { getOperationsFixture } from "@/lib/operations/fixtures";
import type { HumanDecisionRequest } from "@/types/operations";

export function RecommendationCenterPage() {
  const fixture = getOperationsFixture();
  const recommendation = fixture.recommendation;
  const decisionCase = fixture.decision_cases[0];
  const [selectedPlanId, setSelectedPlanId] = useState(recommendation.recommended_plan_id);
  const [preview, setPreview] = useState<HumanDecisionRequest | null>(null);
  const selected = recommendation.candidate_plans.find((plan) => plan.candidate_plan_id === selectedPlanId) ?? recommendation.candidate_plans[0];
  return (
    <OperationsShell title="Recommendation Center" description="Compare validated candidate plans, inspect structured evidence and prepare a human decision request.">
      <OperationsPanel title="Decision case" description="Trigger and lifecycle are displayed from the case resource; refresh/event integration is intentionally outside this fixture pass.">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5"><div><p className="text-xs text-[var(--color-ash-gray)]">Case</p><p className="mt-1 break-all font-mono text-sm font-semibold">{decisionCase.decision_case_id}</p></div><div><p className="text-xs text-[var(--color-ash-gray)]">Trigger</p><p className="mt-1 font-semibold">{decisionCase.trigger.type} · {decisionCase.trigger.machine_id}</p></div><div><p className="text-xs text-[var(--color-ash-gray)]">Mode</p><p className="mt-1"><OperationsStatus value={decisionCase.mode} /></p></div><div><p className="text-xs text-[var(--color-ash-gray)]">Workflow status</p><p className="mt-1"><OperationsStatus value={decisionCase.status} /></p></div></div>
      </OperationsPanel>

      <OperationsPanel title="Why this recommendation?" description="Explanation text and evidence references come from RecommendationPackage.explanation.">
        <div className="p-4 sm:p-5"><p className="max-w-4xl text-sm leading-6">{recommendation.explanation.summary}</p><div className="mt-4 grid gap-4 lg:grid-cols-3"><div><h3 className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">Primary reasons</h3><ul className="mt-2 space-y-2 text-sm">{recommendation.explanation.primary_reasons.map((item) => <li key={item}>• {item}</li>)}</ul></div><div><h3 className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">Tradeoffs</h3><ul className="mt-2 space-y-2 text-sm">{recommendation.explanation.tradeoffs.map((item) => <li key={item}>• {item}</li>)}</ul></div><div><h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--color-ash-gray)]"><ShieldAlert className="h-3.5 w-3.5" />Residual risks</h3><ul className="mt-2 space-y-2 text-sm">{recommendation.explanation.residual_risks.map((item) => <li key={item}>• {item}</li>)}</ul></div></div><p className="mt-4 text-xs text-[var(--color-ash-gray)]">Evidence: {recommendation.explanation.evidence_refs.join(", ")}</p></div>
      </OperationsPanel>

      <OperationsPanel title="Candidate comparison" description="Recommended plan plus two alternatives; only contract-validated candidates are presented as selectable.">
        <CandidateComparison candidates={recommendation.candidate_plans} recommendedPlanId={recommendation.recommended_plan_id} selectedPlanId={selectedPlanId} onSelect={setSelectedPlanId} />
      </OperationsPanel>

      {selected ? <OperationsPanel title="Approval / modify / reject" description="Optimistic concurrency fields use the selected plan version and immutable snapshot ID."><DecisionControls decisionCaseId={decisionCase.decision_case_id} recommendationId={recommendation.recommendation_id} snapshotId={recommendation.snapshot_id} selectedCandidate={selected} modifiedSchedule={fixture.modified_schedule} onDecision={setPreview} /></OperationsPanel> : null}

      {preview ? <OperationsPanel title="Fixture payload preview" description="This request has not been sent. A real adapter will POST it to the backend human-decision boundary."><div className="p-4 sm:p-5"><p role="status" className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700"><FileJson2 className="h-4 w-4" />{preview.decision} request ready for adapter integration</p><pre className="max-h-96 overflow-auto rounded-md bg-stone-950 p-4 text-xs text-stone-100">{JSON.stringify(preview, null, 2)}</pre></div></OperationsPanel> : null}
    </OperationsShell>
  );
}
