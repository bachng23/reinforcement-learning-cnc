"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { OperationsPanel } from "./operations-shell";
import { OperationsApiError, type OperationsApiClient, type OperationsCreateDecisionCaseRequest } from "@/lib/operations-api/client";
import type { OperationsContextData } from "@/lib/operations-api/use-operations-context";
import { useOperationsAction } from "@/lib/operations-api/use-operations-action";
import { getOperationsActorId } from "@/lib/operations-api/actor";

export function CreateDecisionCase({ api, data, mode, onRefresh }: {
  api: OperationsApiClient;
  data: OperationsContextData;
  mode: "mock" | "real";
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [horizon, setHorizon] = useState(720);
  const { snapshotResponse: context } = data;
  const action = useOperationsAction<OperationsCreateDecisionCaseRequest, Awaited<ReturnType<OperationsApiClient["createDecisionCase"]>>>({
    scope: `${mode}:create:${context.factory_id}`,
    getActorId: mode === "real" ? getOperationsActorId : undefined,
    send: async (body, options) => {
      const response = await api.createDecisionCase(body, options);
      if (!response.caseStatus.decision_case_id || response.caseStatus.snapshot_id !== body.expected_snapshot_id
        || response.meta?.factory_id !== body.factory_id || response.meta.base_plan_version !== body.expected_plan_version) throw new OperationsApiError(502, null);
      return response;
    },
    onAccepted: response => {
      if (!response.caseStatus.decision_case_id || response.meta?.factory_id !== context.factory_id) return;
      action.acknowledge();
      router.push(`/operations/recommendations?caseId=${encodeURIComponent(response.caseStatus.decision_case_id)}`);
    },
  });
  const blocked = action.busy || action.hasUnresolvedAction || action.state.kind === "conflict";

  return (
    <OperationsPanel title="Create decision case" description={mode === "real" ? "Request live planning against the displayed backend context. A case does not change the published schedule." : "Preview planning uses the canonical demo; no backend writes occur."}>
      <form className="space-y-4 p-4 sm:p-5" onSubmit={event => {
        event.preventDefault();
        if (blocked || !reason.trim() || !Number.isInteger(horizon) || horizon < 1 || horizon > 10080) return;
        action.start({ schema_version: "3.0", factory_id: context.factory_id,
          expected_snapshot_id: context.snapshot_id, expected_plan_version: context.plan_version,
          request: { mode: "LIVE", trigger: { type: "MANUAL_REPLAN", reason: reason.trim() }, planning_config: { horizon_minutes: horizon } } });
      }}>
        <p className="break-all text-xs text-[var(--color-ash-gray)]">Basis: <code>{context.snapshot_id}</code> · head plan version {context.plan_version}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <label className="text-xs font-semibold">Planning reason
            <textarea aria-label="Planning reason" required maxLength={4000} disabled={blocked} value={reason} onChange={event => setReason(event.target.value)} rows={2} className="mt-1 block w-full rounded-md border p-3 text-sm" />
          </label>
          <label className="text-xs font-semibold">Horizon (minutes)
            <input aria-label="Planning horizon" type="number" min={1} max={10080} required disabled={blocked} value={horizon} onChange={event => setHorizon(Number(event.target.value))} className="mt-1 block w-full rounded-md border p-3 text-sm" />
          </label>
        </div>
        {action.state.kind !== "idle" ? <p role={action.busy ? "status" : "alert"} className="text-sm">{action.state.message}</p> : null}
        {action.state.kind === "unauthorized" ? <Link href="/login" className="text-sm underline">Sign in with decision permission</Link> : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={blocked || !reason.trim()} className="min-h-10 rounded-md bg-sky-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{action.busy ? "Creating case…" : "Create case"}</button>
          {action.state.kind === "recoverable" || action.state.kind === "unauthorized" ? <button type="button" onClick={action.recover} className="min-h-10 rounded-md border px-4 text-sm">Recover create outcome</button> : null}
          {action.state.kind === "conflict" ? <button type="button" onClick={() => { action.acknowledge(); onRefresh(); }} className="min-h-10 rounded-md border px-4 text-sm">Refresh context and review</button> : null}
        </div>
      </form>
    </OperationsPanel>
  );
}
