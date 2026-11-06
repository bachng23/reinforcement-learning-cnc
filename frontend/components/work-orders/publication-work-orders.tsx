"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AsyncState } from "@/components/research/async-state";
import { WorkOrderAccess, WorkOrderFailure } from "./work-orders-frame";
import { useWorkspaceUser } from "@/lib/workspace-user";
import type { TokenUser } from "@/lib/auth";
import { useOperationsOverview, type OperationsApiClient } from "@/lib/operations-api";
import { operationsUiClient } from "@/lib/operations-ui";
import type { OperationsCommitMetadata } from "@/lib/operations-api/client";
import { errorExplanation, WorkOrdersError, workOrdersApi, type WorkOrdersClient } from "@/lib/work-orders/client";
import { workOrderDetailHref, workOrdersHref, workOrderTime } from "@/lib/work-orders/navigation";
import { useWorkOrderIntent } from "@/lib/work-orders/use-work-order-intent";
import type { FactorySnapshot, Schedule, ScheduleAssignment } from "@/types/generated/operations";
import type { WorkOrderCreateRequest, WorkOrderResponse } from "@/types/generated/work-orders";

export function PublicationWorkOrders({ commit, snapshot, schedule, api = workOrdersApi, contextApi }: {
  commit: OperationsCommitMetadata; snapshot: FactorySnapshot; schedule: Schedule; api?: WorkOrdersClient; contextApi?: OperationsApiClient;
}) {
  const actor = useWorkspaceUser();
  const [expanded, setExpanded] = useState(false);
  const assignments = schedule.assignments?.filter(item => item.assignment_type === "MAINTENANCE" && item.status !== "CANCELLED") ?? [];
  if (!actor || !assignments.length) return null;
  return <details className="rounded-lg border border-blue-200 bg-slate-50 p-4" onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold text-blue-800 focus-visible:ring-2">Maintenance assignments / Work Orders</summary><p className="mt-2 text-xs leading-5 text-slate-500">Work orders are explicit, not automatically dispatched. This is the exact COMMIT publication, never a candidate preview or latest-head substitution.</p>
    {expanded ? <WorkOrderAccess api={api} factoryId={commit.factory_id}>{(current, fresh) => <PublicationWorkOrderContent actor={current} sessionFresh={fresh} commit={commit} snapshot={snapshot} assignments={assignments} api={api} contextApi={contextApi ?? operationsUiClient("real")} />}</WorkOrderAccess> : null}
  </details>;
}

function PublicationWorkOrderContent({ actor, sessionFresh, commit, snapshot, assignments, api, contextApi }: { actor: TokenUser; sessionFresh: boolean; commit: OperationsCommitMetadata; snapshot: FactorySnapshot; assignments: ScheduleAssignment[]; api: WorkOrdersClient; contextApi: OperationsApiClient }) {
  const router = useRouter();
  const { state, refresh } = useOperationsOverview({ api: contextApi, factoryId: commit.factory_id });
  const [selected, setSelected] = useState<ScheduleAssignment | null>(null);
  const [override, setOverride] = useState("");
  const [overrideRequired, setOverrideRequired] = useState(false);
  const [existing, setExisting] = useState<Record<string, string>>({});
  const [originError, setOriginError] = useState("");
  const originEpoch = useRef(0);
  useEffect(() => {
    originEpoch.current += 1; setExisting({}); setOriginError("");
    return () => { originEpoch.current += 1; };
  }, [actor.id, actor.role, sessionFresh, commit.factory_id, commit.schedule_id, commit.schedule_revision]);
  const [created, setCreated] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const context = state.kind === "ready" ? state.data.context : null;
  const matches = context && context.factory_id === commit.factory_id && context.plan_version === commit.plan_version
    && context.publication?.schedule_id === commit.schedule_id && context.publication.schedule_revision === commit.schedule_revision
    && context.publication.basis_snapshot_id === commit.snapshot_id;
  const management = sessionFresh && (actor.role === "ADMIN" || actor.role === "ENGINEER");
  const intent = useWorkOrderIntent<WorkOrderCreateRequest, WorkOrderResponse>({ api, actor, scope: `create:${commit.factory_id}:${commit.decision_case_id}:${commit.schedule_id}:${commit.schedule_revision}`,
    send: async (body, options) => {
      const receipt = await api.create(body, options);
      let result: WorkOrderResponse;
      try { result = await api.detail(receipt.data.id, { signal: options.signal }); }
      catch (failure: unknown) {
        // POST already succeeded: a failed follow-up GET is not a rejected
        // create and must not unlock a different key/body.
        throw new WorkOrdersError(503, "WORK_ORDER_OUTCOME_UNVERIFIED", failure instanceof WorkOrdersError ? failure.requestId : undefined);
      }
      if (result.data.factory_id !== body.factory_id || result.data.source.decision_case_id !== body.source.decision_case_id
        || result.data.source.schedule_id !== body.source.schedule_id || result.data.source.schedule_revision !== body.source.schedule_revision
        || result.data.source.assignment_id !== body.source.assignment_id || result.data.source.schedule_hash !== body.source.schedule_hash) throw new WorkOrdersError(502, "INVALID_RESPONSE");
      return result;
    },
    onAccepted: response => { setCreated(response.data.id); window.dispatchEvent(new Event("work-orders-changed")); },
    onRejected: error => { if (error.code === "WORK_ORDER_OVERLAP") setOverrideRequired(true); refresh(); },
  });
  useEffect(() => {
    if (created && intent.state.kind === "accepted") { intent.reviewed(); router.push(workOrderDetailHref(created, commit.factory_id)); }
  }, [created, intent, router, commit.factory_id]);
  useEffect(() => {
    if (!selected || !dialog.current) return;
    if (!sessionFresh) { if (typeof dialog.current.close === "function") dialog.current.close(); else dialog.current.removeAttribute("open"); return; }
    if (typeof dialog.current.showModal === "function" && !dialog.current.open) dialog.current.showModal();
    else dialog.current.setAttribute("open", "");
    return () => { requestAnimationFrame(() => trigger.current?.focus()); };
  }, [selected, sessionFresh]);
  useEffect(() => {
    if (!intent.unresolved && !override.trim()) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave);
  }, [intent.unresolved, override]);
  const openExisting = async (assignmentId: string) => {
    if (!sessionFresh) return;
    const epoch = originEpoch.current;
    setOriginError("");
    try { const result = await api.byOrigin(commit.factory_id, commit.schedule_id, commit.schedule_revision, assignmentId); if (epoch === originEpoch.current) setExisting(old => ({ ...old, [assignmentId]: result.data.id })); }
    catch (error) { if (epoch === originEpoch.current) setOriginError(errorExplanation(error instanceof WorkOrdersError ? error : new WorkOrdersError(0, "REQUEST_FAILED"))); }
  };
  const close = () => { if (intent.busy) return; if ((override.trim() || intent.state.kind === "uncertain") && !window.confirm("Close this review? An unconfirmed create may already exist. The original request remains in memory only; do not create another intent to recover it.")) return; setSelected(null); };
  const rejected = intent.state.kind === "rejected";
  return <div className="mt-4 space-y-4">
    <Link className="text-sm font-medium text-blue-700 underline" href={workOrdersHref({ factory_id: commit.factory_id })}>Open factory Work Orders</Link>
    {state.kind === "loading" ? <AsyncState compact kind="loading" title="Checking current publication/head before creation" /> : null}
    {"message" in state ? <AsyncState compact kind="error" title="Creation context unavailable" description={state.message} onRetry={refresh} /> : null}
    {context && !matches ? <p role="status" className="border-l-2 border-amber-500 pl-3 text-sm text-amber-900">Historical source: creation is unavailable because the current publication differs. Existing work orders remain executable. This source will not be replaced with P2.</p> : null}
    {actor.role === "VIEWER" ? <p className="text-sm text-slate-500">VIEWER access is read-only.</p> : null}
    {intent.state.kind === "uncertain" ? <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4"><p role="alert" className="text-sm">Create outcome unconfirmed for assignment <code className="break-all">{intent.original?.source.assignment_id}</code>. Retry the original key/body/head; it may already have succeeded. No new intent is allowed.</p><button className="dss-primary" disabled={intent.busy} onClick={intent.retry}>Retry original create</button></div> : null}
    {intent.state.error ? <WorkOrderFailure error={intent.state.error} retry={refresh} /> : null}
    {rejected ? <button className="dss-secondary" disabled={state.kind !== "ready"} onClick={intent.reviewed}>I reviewed this original source and refreshed context</button> : null}
    <div className="overflow-auto rounded border bg-white" role="region" aria-label="Published maintenance assignments" tabIndex={0}><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-100 text-xs text-slate-500"><tr><th className="p-3">Machine / request</th><th className="p-3">Planned window</th><th className="p-3">Assignment</th><th className="p-3">Create</th></tr></thead><tbody className="divide-y">{assignments.map(assignment => <tr key={assignment.assignment_id}><td className="p-3"><p className="font-mono">{assignment.machine_id}</p><p className="mt-1 break-all text-xs text-slate-500">{assignment.maintenance_request_id ?? "Not provided"}</p></td><td className="p-3 font-mono text-xs tabular-nums">{workOrderTime(assignment.start_at)}<br />to {workOrderTime(assignment.end_at)}</td><td className="max-w-48 break-all p-3 font-mono text-xs">{assignment.assignment_id}</td><td className="p-3">{sessionFresh ? existing[assignment.assignment_id] ? <Link className="dss-secondary" href={workOrderDetailHref(existing[assignment.assignment_id], commit.factory_id)}>Open existing work order</Link> : <button className="dss-secondary" onClick={() => openExisting(assignment.assignment_id)}>Find existing work order</button> : null}{management ? <button className="dss-primary" disabled={!matches || intent.unresolved || intent.busy} onClick={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(assignment); }}>Review create work order</button> : <span className="text-xs text-slate-500">Management access required</span>}</td></tr>)}</tbody></table></div>
    {originError ? <p role="alert" className="text-sm text-rose-800">{originError}</p> : null}
    {selected ? <dialog ref={dialog} aria-labelledby="wo-create-title" onCancel={event => { event.preventDefault(); close(); }} className="fixed inset-0 z-50 m-auto max-h-[90vh] w-[calc(100%-3rem)] max-w-2xl overflow-y-auto rounded-xl border bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><form className="space-y-4" onSubmit={event => {
      event.preventDefault();
      if (!context || !matches || !management || intent.unresolved || intent.busy || (overrideRequired && !override.trim())) return;
      intent.start({ factory_id: commit.factory_id, source: { decision_case_id: commit.decision_case_id, schedule_id: commit.schedule_id, schedule_revision: commit.schedule_revision, schedule_hash: commit.schedule_hash, assignment_id: selected.assignment_id },
        expected_head: { snapshot_id: context.snapshot_id, plan_version: context.plan_version, revision: context.head_revision }, ...(overrideRequired ? { overlap_override_reason: override.trim() } : {}) });
    }}><h2 id="wo-create-title" className="text-lg font-semibold">Create work order from this publication</h2><dl className="grid gap-3 text-sm md:grid-cols-2">{[["Factory", commit.factory_id], ["Machine", selected.machine_id], ["Maintenance request", selected.maintenance_request_id ?? "Not provided"], ["Source work", snapshot.maintenance_requests?.find(request => request.maintenance_request_id === selected.maintenance_request_id)?.action_type ?? "Not provided"], ["Planned start", workOrderTime(selected.start_at)], ["Planned end", workOrderTime(selected.end_at)], ["Published plan / schedule revision", `${commit.plan_version} / ${commit.schedule_revision}`], ["Assignment", selected.assignment_id]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}</dl><p className="break-all text-xs text-slate-500">Source schedule {commit.schedule_id}<br />Basis {commit.snapshot_id}<br />Current observation {context?.snapshot_id ?? "Not available"} · head revision {context?.head_revision ?? "Not available"}. These tokens are not the schedule revision.</p>
      {!matches ? <p role="alert" className="text-sm text-amber-900">Current source changed. This original assignment stays selected for comparison; no P2 assignment is substituted.</p> : null}
      {intent.state.error ? <p role="alert" className="text-sm text-rose-800">{errorExplanation(intent.state.error)}{intent.state.error.requestId ? ` Request ${intent.state.error.requestId}` : ""}</p> : null}
      {overrideRequired ? <label className="block text-sm font-medium">Explicit overlap override reason<textarea required disabled={intent.busy || intent.unresolved} maxLength={4000} rows={3} className="dss-input mt-1 py-2" value={override} onChange={event => setOverride(event.target.value)} /><span className="mt-2 block text-xs text-slate-500">This changes the body and is a new intent with a new key. No default reason is supplied.</span></label> : null}
      {rejected ? <button type="button" className="dss-secondary" disabled={state.kind !== "ready"} onClick={intent.reviewed}>I reviewed the rejection and refreshed context</button> : null}
      {intent.state.kind === "uncertain" ? <button type="button" className="dss-primary" onClick={intent.retry}>Retry original create</button> : null}
      {intent.busy ? <p role="status">Submitting original create…</p> : null}
      <div className="flex justify-end gap-2"><button type="button" className="dss-secondary" disabled={intent.busy} onClick={close}>Close review</button><button type="submit" className="dss-primary" disabled={!matches || !management || intent.unresolved || intent.busy || (overrideRequired && !override.trim())}>{intent.busy ? "Creating…" : overrideRequired ? "Create with explicit overlap override" : "Create work order"}</button></div>
    </form></dialog> : null}
  </div>;
}
