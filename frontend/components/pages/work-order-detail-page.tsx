"use client";

import Link from "next/link";
import { OperationsPanel } from "@/components/operations/operations-shell";
import { AsyncState } from "@/components/research/async-state";
import { CopyIdentity, WorkOrderBadge as OperationsStatus, WorkOrderFailure, WorkOrdersFrame } from "@/components/work-orders/work-orders-frame";
import { WorkOrderActions } from "@/components/work-orders/work-order-actions";
import { WorkOrdersError, workOrdersApi, type WorkOrdersClient } from "@/lib/work-orders/client";
import { useWorkOrderEvents, useWorkOrderRead } from "@/lib/work-orders/use-work-orders";
import { workOrderReturnHref, workOrderTime } from "@/lib/work-orders/navigation";
import { operationsHref } from "@/lib/operations-ui";
import type { TokenUser } from "@/lib/auth";
import type { WorkOrderReport } from "@/types/generated/work-orders";

export function WorkOrderReportView({ report }: { report: WorkOrderReport }) {
  return <dl className="space-y-3 text-sm" aria-label="Completion report"><div><dt className="text-xs text-slate-500">Reported outcome</dt><dd className="mt-1 font-semibold">{report.outcome}</dd></div><div><dt className="text-xs text-slate-500">Work performed</dt><dd className="mt-1 whitespace-pre-wrap break-words">{report.work_performed}</dd></div><div><dt className="text-xs text-slate-500">Result</dt><dd className="mt-1 whitespace-pre-wrap break-words">{report.result}</dd></div>{report.stop_reason ? <div><dt className="text-xs text-slate-500">Stop reason</dt><dd className="mt-1 whitespace-pre-wrap break-words">{report.stop_reason}</dd></div> : null}</dl>;
}

export function WorkOrderDetailPage({ id, factoryHint, returnTo, api = workOrdersApi }: { id: string; factoryHint?: string; returnTo?: string; api?: WorkOrdersClient }) {
  return <WorkOrdersFrame title="Work Order detail" factoryId={factoryHint} api={api}>{(actor, fresh) => <WorkOrderDetail key={`${actor.id}:${id}:${factoryHint ?? ""}`} api={api} actor={actor} id={id} factoryHint={factoryHint} returnTo={returnTo} sessionFresh={fresh} />}</WorkOrdersFrame>;
}

function History({ api, actor, id, factoryId, refreshToken }: { api: WorkOrdersClient; actor: TokenUser; id: string; factoryId: string; refreshToken: string }) {
  const history = useWorkOrderEvents({ api, actor, id, factoryId, refreshToken });
  return <OperationsPanel title="Attempts and audit timeline" description="Append-only API events in ascending sequence. Old completion reports and rework decisions remain visible; actor IDs are not replaced with invented names.">
    <div className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-slate-500">{history.events.length} events loaded · {history.pages} pages · {history.meta ? history.meta.has_more ? "History incomplete — more pages available" : "Complete read at this timestamp" : "History not yet verified"}{history.meta ? ` · ${workOrderTime(history.meta.read_at)}` : ""}</p><button className="dss-secondary" disabled={history.busy} onClick={history.refresh}>Refresh history</button></div>
      {history.busy ? <AsyncState compact kind="loading" title="Reading command history" /> : null}
      {history.busy && history.events.length ? <p role="status" className="text-xs text-amber-900">Previous history read shown while refreshing. It is not a newly verified read.</p> : null}
      {history.error ? <WorkOrderFailure error={history.error} retry={history.refresh} /> : null}
      {!history.busy && !history.error && history.meta && !history.events.length ? <AsyncState compact kind="empty" title="No events returned" description="No event rows were supplied in this API read; no local history is fabricated." /> : null}
      <ol aria-label="Work Order events" className="space-y-3">{history.events.map(event => <li key={event.id} data-sequence={event.sequence} className="rounded-md border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="text-sm font-semibold">#{event.sequence} · {event.command} · attempt {event.payload.attempt}</h3><time className="font-mono text-xs tabular-nums" dateTime={event.occurred_at}>{workOrderTime(event.occurred_at)}</time></div><p className="mt-2 break-all text-xs text-slate-500">Actor <code>{event.actor_id}</code> · revision {event.payload.revision}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs">{event.payload.from_status ? <OperationsStatus value={event.payload.from_status} /> : <span>Created</span>}<span aria-label="to">→</span><OperationsStatus value={event.payload.to_status} /></div>
        {event.payload.assignee_user_id ? <p className="mt-3 break-all text-xs">Assignee <code>{event.payload.assignee_user_id}</code></p> : null}
        {event.payload.reason ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">Reason: {event.payload.reason}</p> : null}
        {event.payload.report ? <div className="mt-4 border-t pt-4"><WorkOrderReportView report={event.payload.report} /></div> : null}
        {event.payload.verification ? <div className="mt-3 border-t pt-3 text-sm"><p className="font-semibold">{event.payload.verification.result}</p><p className="mt-1 whitespace-pre-wrap break-words">{event.payload.verification.note}</p></div> : null}
        {event.payload.overlap_override_reason ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">Explicit overlap override: {event.payload.overlap_override_reason}</p> : null}
        {event.payload.overlapping_work_order_ids?.length ? <p className="mt-2 break-all font-mono text-xs">Overlapping orders: {event.payload.overlapping_work_order_ids.join(", ")}</p> : null}
      </li>)}</ol>
      {history.meta?.has_more ? <button className="dss-primary" disabled={history.busy} onClick={history.loadMore}>Load more history</button> : null}
    </div>
  </OperationsPanel>;
}

function WorkOrderDetail({ api, actor, id, factoryHint, returnTo, sessionFresh }: { api: WorkOrdersClient; actor: TokenUser; id: string; factoryHint?: string; returnTo?: string; sessionFresh: boolean }) {
  const { state, refresh } = useWorkOrderRead({ api, actor, scope: `detail:${factoryHint ?? "authoritative"}:${id}`, read: async options => {
    const response = await api.detail(id, options);
    if (factoryHint && response.data.factory_id !== factoryHint) throw new WorkOrdersError(502, "FACTORY_CONTEXT_MISMATCH");
    return response;
  } });
  const response = "data" in state ? state.data : undefined;
  const order = response?.data;
  const fresh = sessionFresh && state.kind === "ready";
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{order ? `${order.machine_id} · Order ${order.id.slice(0, 8)}` : "Work Order detail"}</h1>{order ? <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><OperationsStatus value={order.status} /><span>Assignee: {order.assignee?.username ?? "Unassigned"}</span><span className={order.overdue ? "text-amber-800" : "text-slate-500"}>{order.overdue ? "Overdue (server flag)" : "Not overdue (server flag)"}</span>{order.waiting_verification ? <span className="font-semibold text-amber-800">Waiting independent verification</span> : null}</div> : null}</div><button className="dss-primary" disabled={!sessionFresh || state.kind === "loading"} onClick={refresh}>Refresh order</button></header>
    {order ? <div id="work-order-primary-action" aria-label="Primary Work Order action" /> : null}
    <Link className="inline-flex text-sm font-medium text-blue-700 underline" href={workOrderReturnHref(returnTo, order?.factory_id ?? factoryHint ?? "")}>Back to filtered work orders</Link>
    {state.kind === "loading" ? <AsyncState compact kind="loading" title={order ? "Refreshing detail — previous read shown; commands disabled" : "Loading authoritative work order"} /> : null}
    {state.kind === "error" && "error" in state && state.error ? <WorkOrderFailure error={state.error} retry={refresh} /> : null}
    {response && order ? <>
      <p className="break-all text-xs text-slate-500">Factory <code>{order.factory_id}</code> · read {workOrderTime(response.meta.read_at)} · revision {order.revision} · <CopyIdentity value={order.id} label="work order ID" /></p>
      <OperationsPanel title="Work requirements and execution context" description="Immutable source requirements and planned UTC window are distinct from actual execution and attempts."><dl className="grid gap-5 p-5 text-sm md:grid-cols-3 xl:grid-cols-4">{[
        ["Maintenance request", order.maintenance_request_id], ["Work type / action", `${order.requirements.maintenance_type} / ${order.requirements.action_type}`], ["Priority (source)", order.requirements.priority], ["Current attempt", String(order.attempt)],
        ["Planned start", workOrderTime(order.planned_start_at)], ["Planned end", workOrderTime(order.planned_end_at)], ["Actual original start", workOrderTime(order.actual_started_at)], ["Actual completion", workOrderTime(order.actual_completed_at)],
        ["Required skills", order.requirements.required_skill_ids.join(", ") || "None returned"], ["Minimum skill level", String(order.requirements.minimum_skill_level)], ["Expected duration", `${order.requirements.expected_duration_minutes} minutes (source)`], ["Mandatory", order.requirements.mandatory ? "Yes" : "No"],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 break-words font-medium tabular-nums [overflow-wrap:anywhere]">{value}</dd></div>)}</dl></OperationsPanel>
      <OperationsPanel title="Execution and latest report" description="Completion is a report, not automatic verification or physical machine recovery."><div className="space-y-5 p-5">
        {order.blocker ? <p className="whitespace-pre-wrap break-words border-l-4 border-amber-500 pl-3 text-sm">Blocker / hold reason: {order.blocker}</p> : null}
        {order.latest_completion ? <div className="space-y-3"><h3 className="text-sm font-semibold">Latest completion · attempt {order.latest_completion.attempt}</h3><p className="break-all text-xs text-slate-500">Reported by {order.latest_completion.actor_id} · {workOrderTime(order.latest_completion.completed_at)}</p><WorkOrderReportView report={order.latest_completion.report} /></div> : <p className="text-sm text-slate-500">No completion report has been returned for this order.</p>}
        {order.verification ? <div className="space-y-2 border-t pt-4 text-sm"><p className="font-semibold">Recorded verification: {order.verification.result}</p><p className="whitespace-pre-wrap break-words">{order.verification.note}</p><p className="break-all text-xs text-slate-500">By {order.verification.actor_id} · {workOrderTime(order.verification.verified_at)}</p>{order.verification.result === "VERIFIED_STOPPED" ? <p className="text-amber-900">STOPPED was independently verified. This does not mean the machine is recovered or healthy.</p> : <p className="text-xs text-slate-500">Verification is recorded for this work report, not an update to telemetry or machine health.</p>}</div> : null}
        {order.cancel_reason ? <p className="whitespace-pre-wrap break-words border-t pt-4 text-sm">Cancellation reason: {order.cancel_reason}<br /><span className="text-xs text-slate-500">{workOrderTime(order.cancelled_at)}</span></p> : null}
      </div></OperationsPanel>
      <WorkOrderActions api={api} actor={actor} response={response} fresh={fresh} refresh={refresh} primaryTargetId="work-order-primary-action" />
      <History api={api} actor={actor} id={order.id} factoryId={order.factory_id} refreshToken={`${order.revision}:${response.meta.read_at}`} />
      <OperationsPanel title="Historical source and provenance" description="Source S1/P1 is never rebased onto S2/P2. A historical source does not invalidate execution of an existing order."><div className="space-y-4 p-5"><div className="flex flex-wrap gap-4 text-sm"><span>{order.source_is_current ? "Source publication is current" : "Historical source publication"}</span><span>{order.machine_in_current_snapshot === null ? "Current machine presence not provided (no observation head)" : order.machine_in_current_snapshot ? "Machine present in current observation" : "Machine absent from current observation — historical order remains valid"}</span></div>
        <div className="flex flex-wrap gap-3"><Link className="dss-secondary" href={operationsHref("/operations/schedule", order.factory_id, { caseId: order.source.decision_case_id, schedule_id: order.source.schedule_id, schedule_revision: String(order.source.schedule_revision), assignment_id: order.source.assignment_id })}>Open exact published plan</Link><Link className="dss-secondary" href={operationsHref("/operations/recommendations", order.factory_id, { caseId: order.source.decision_case_id })}>Open source decision case</Link></div>
        <p className="break-words text-sm">Published plan {order.source.published_plan_version} · schedule revision {order.source.schedule_revision} · assignment <code className="break-all">{order.source.assignment_id}</code></p>
        <details className="rounded border p-4"><summary className="cursor-pointer text-sm font-semibold focus-visible:ring-2">Technical source identities and hashes</summary><dl className="mt-4 grid gap-4 text-xs lg:grid-cols-2">{Object.entries({ "Basis snapshot": order.basis_snapshot_id, "Source basis snapshot": order.source.basis_snapshot_id, "Basis hash": order.source.basis_snapshot_hash, "Decision case": order.source.decision_case_id, "Schedule ID": order.source.schedule_id, "Schedule hash": order.source.schedule_hash, "Assignment": order.source.assignment_id }).map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-all font-mono">{value}</dd><div className="mt-2"><CopyIdentity label={label} value={value} /></div></div>)}</dl><p className="mt-4 text-xs text-slate-500">Source technician resource IDs (not user accounts): {order.source_technician_ids.join(", ") || "None returned"}</p></details>
      </div></OperationsPanel>
    </> : null}
  </div>;
}
