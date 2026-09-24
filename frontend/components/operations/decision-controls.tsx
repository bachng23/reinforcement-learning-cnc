"use client";

import { Check, LoaderCircle, PenLine, X } from "lucide-react";
import { useState } from "react";

import type { CandidatePlan, HumanDecisionRequest, Schedule } from "@/types/generated/operations";

export interface DecisionControlsProps {
  decisionCaseId: string;
  recommendationId: string;
  snapshotId: string;
  selectedCandidate: CandidatePlan;
  modifiedSchedule?: Schedule;
  busy?: boolean;
  onDecision: (request: HumanDecisionRequest) => void | Promise<void>;
}

type Choice = "APPROVE" | "MODIFY" | "REJECT";

export function DecisionControls({ decisionCaseId, recommendationId, snapshotId, selectedCandidate, modifiedSchedule, busy = false, onDecision }: DecisionControlsProps) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (!choice || busy) return;
    if (choice === "REJECT" && !note.trim()) {
      setError("A rejection note is required by the v3 contract.");
      return;
    }
    if (choice === "MODIFY" && !modifiedSchedule) {
      setError("Attach a modified schedule from the schedule editor before submitting.");
      return;
    }
    setError("");
    const common = { schema_version: "3.0" as const, decision_case_id: decisionCaseId, recommendation_id: recommendationId, expected_snapshot_id: snapshotId };
    const request: HumanDecisionRequest = choice === "REJECT"
      ? { ...common, decision: "REJECT", note: note.trim() }
      : choice === "MODIFY"
        ? { ...common, decision: "MODIFY", candidate_plan_id: selectedCandidate.candidate_plan_id, expected_plan_version: selectedCandidate.plan_version, modified_schedule: modifiedSchedule!, ...(note.trim() ? { note: note.trim() } : {}) }
        : { ...common, decision: "APPROVE", candidate_plan_id: selectedCandidate.candidate_plan_id, expected_plan_version: selectedCandidate.plan_version, ...(note.trim() ? { note: note.trim() } : {}) };
    void onDecision(request);
  };

  return (
    <div className="p-4 sm:p-5">
      <p className="text-sm text-[var(--color-ash-gray)]">Controls build a contract-shaped <code>HumanDecisionRequest</code>. In fixture mode the payload is previewed only.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setChoice("APPROVE"); setError(""); }} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><Check className="h-4 w-4" />Approve</button>
        <button type="button" onClick={() => { setChoice("MODIFY"); setError(""); }} className="inline-flex items-center gap-2 rounded-md border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700"><PenLine className="h-4 w-4" />Modify</button>
        <button type="button" onClick={() => { setChoice("REJECT"); setError(""); }} className="inline-flex items-center gap-2 rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700"><X className="h-4 w-4" />Reject</button>
      </div>
      {choice ? <div className="mt-4 rounded-md border border-[var(--color-stone-border)] bg-stone-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">Confirm {choice.toLowerCase()}</strong><span className="font-mono text-xs text-[var(--color-ash-gray)]">{selectedCandidate.candidate_plan_id} · expected v{selectedCandidate.plan_version}</span></div>
        <label htmlFor="decision-note" className="mt-3 block text-xs font-semibold">Decision note {choice === "REJECT" ? "(required)" : "(optional)"}</label>
        <textarea id="decision-note" rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-stone-border)] bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-sky-300" placeholder="Record the human rationale" />
        {choice === "MODIFY" ? <p className="mt-2 text-xs text-[var(--color-ash-gray)]">Attached draft: {modifiedSchedule ? `${modifiedSchedule.schedule_id} · revision ${modifiedSchedule.revision}` : "none"}</p> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setChoice(null)} disabled={busy} className="rounded-md border bg-white px-3 py-2 text-sm">Cancel</button><button type="button" onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-[var(--color-slate-text)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Preview request</button></div>
      </div> : null}
    </div>
  );
}
