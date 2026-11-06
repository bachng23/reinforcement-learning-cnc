"use client";
import Link from "next/link";
import { useState } from "react";
import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { CommandForm, buttonClass } from "@/components/incidents/incident-forms";
import { detail, incidentRequest, type Detail, type Event, type Occurrence, type Evidence } from "@/lib/incidents/client";
import { useIncidentRead } from "@/lib/incidents/use-incident-read";
import { useWorkspaceUser } from "@/lib/workspace-user";
import { formatDateTime } from "@/lib/operations/format";

function EvidenceView({ evidence }: { evidence: Evidence }) {
  if (evidence.kind === "manual") return <div><p className="text-xs font-semibold uppercase text-stone-500">Human observation — not sensor telemetry</p><p className="mt-2 whitespace-pre-wrap">{evidence.report_text}</p></div>;
  return <div className="space-y-3">
    <p className="text-xs font-semibold uppercase text-stone-500">Immutable LIVE health-alert case evidence</p>
    <dl className="grid gap-3 text-xs md:grid-cols-2"><div><dt>Case ID</dt><dd className="break-all font-mono">{evidence.case_id}</dd></div>
      <div><dt>Basis snapshot / machine</dt><dd>{evidence.basis_snapshot_id} / {evidence.machine_id}</dd></div>
      <div><dt>Case created (not sensor event time)</dt><dd>{formatDateTime(evidence.case_created_at)}</dd></div>
      <div><dt>Trigger probability / threshold (not severity)</dt><dd>{evidence.trigger.failure_probability} / {evidence.trigger.alert_threshold}</dd></div></dl>
    {evidence.health_samples.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Sample", "Observed", "Model", "Horizon", "Probability", "Health / confidence"].map(s => <th className="p-2" key={s}>{s}</th>)}</tr></thead><tbody>{evidence.health_samples.map(s => <tr key={s.health_snapshot_id} className="border-t"><td className="p-2">{s.health_snapshot_id}</td><td className="p-2">{formatDateTime(s.observed_at)}</td><td className="p-2">{s.source_model_version}</td><td className="p-2">{s.failure_probability_horizon_minutes} min</td><td className="p-2">{s.failure_probability}</td><td className="p-2">{s.health_index} / {s.confidence}</td></tr>)}</tbody></table></div>
      : <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">No health samples in this immutable basis. Missing evidence is not a healthy reading.</p>}
  </div>;
}
function History({ id, kind }: { id: string; kind: "events" | "occurrences" }) {
  const [after, setAfter] = useState(0);
  const state = useIncidentRead(id + ":" + kind + ":" + after, signal =>
    incidentRequest<(Event | Occurrence)[]>("/incidents/" + encodeURIComponent(id) + "/" + kind + "?after_sequence=" + after + "&limit=25", { signal }));
  return <OperationsPanel title={kind === "events" ? "Audit timeline" : "Evidence and occurrences"}
    description={kind === "events" ? "Append-only actions, actors and prior resolution attempts." : "Each source is recorded once. Reopening does not rewrite earlier evidence."}>
    <div className="space-y-4 p-5">
      {state.busy ? <p role="status">Loading {kind}…</p> : null}
      {state.error ? <div role="alert"><p>{state.error}</p><button className={buttonClass} onClick={state.refresh}>Retry {kind}</button></div> : null}
      {state.data?.data.map(row => <article key={row.id} className="rounded-lg border p-4">
        <p className="mb-3 break-all text-xs text-stone-600">#{row.sequence} · Actor {row.actor_id} · {formatDateTime("occurred_at" in row ? row.occurred_at : row.recorded_at)}</p>
        {"command" in row ? <><h3 className="font-semibold">{row.command.replaceAll("_", " ")}</h3><dl className="mt-3 space-y-2 text-sm">{Object.entries(row.payload).map(([name, value]) => <div key={name} className="grid gap-1 md:grid-cols-[180px_1fr]"><dt className="text-stone-500">{name.replaceAll("_", " ")}</dt><dd className="whitespace-pre-wrap break-all">{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "—")}</dd></div>)}</dl></>
          : <EvidenceView evidence={row.evidence} />}
      </article>)}
      {state.data && !state.data.data.length ? <p>No {kind} on this page.</p> : null}
      <div className="flex gap-3">{after > 0 ? <button className={buttonClass} onClick={() => setAfter(0)}>First {kind}</button> : null}
        {state.data?.meta.has_more ? <button className={buttonClass} onClick={() => setAfter(state.data!.meta.next_after_sequence!)}>Next {kind}</button> : null}</div>
    </div>
  </OperationsPanel>;
}
function Actions({ data, onSaved }: { data: Detail; onSaved: () => void }) {
  const user = useWorkspaceUser();
  if (!user) return <p>Loading permissions…</p>;
  return <CommandForm key={data.incident.id + ":" + data.incident.revision} data={data} manager={["ADMIN", "ENGINEER"].includes(user.role)} onSaved={onSaved} />;
}
export function IncidentDetailPage({ id, factoryId }: { id: string; factoryId: string }) {
  const state = useIncidentRead(factoryId + ":" + id, signal => detail(id, factoryId, signal));
  const data = state.data?.data;
  const row = data?.incident;
  return <OperationsShell title="Incident detail" description="Evidence first, accountable action, independent verification." factoryId={factoryId}
    dataSource="live" dataSourceMessage="Live Incident API. Linked case/order lifecycle is independent. No action here changes telemetry or publishes a schedule."
    actions={<div className="flex gap-2"><Link className={buttonClass} href={"/operations/incidents?factory_id=" + encodeURIComponent(factoryId)}>All incidents</Link><button className={buttonClass} disabled={state.busy} onClick={state.refresh}>Refresh incident</button></div>}>
    {state.busy ? <p role="status">Loading incident…</p> : null}
    {state.error ? <div role="alert" className="rounded border border-rose-300 bg-rose-50 p-5"><p>{state.error}</p><button className={buttonClass + " mt-3"} onClick={state.refresh}>Retry incident</button></div> : null}
    {data && row ? <>
      <OperationsPanel title={row.title} description={row.id}>
        <div className="space-y-4 p-5"><div className="flex flex-wrap gap-2"><OperationsStatus value={row.status} /><OperationsStatus value={row.severity ?? "AWAITING CONFIRMATION"} /><span className="p-1 text-sm">Revision {row.revision} · {row.category}</span></div>
          <p className="whitespace-pre-wrap">{data.description}</p>
          <dl className="grid gap-4 text-sm md:grid-cols-3"><div><dt className="text-stone-500">Current owner</dt><dd className="break-all">{row.owner_user_id ?? "Unassigned"}</dd></div>
            <div><dt className="text-stone-500">Machine / immutable basis</dt><dd>{row.machine ? row.machine.machine_id + " / " + row.machine.basis_snapshot_id : "Factory-level incident"}</dd></div>
            <div><dt className="text-stone-500">Occurrence count / proposal</dt><dd>{row.occurrence_count} / {row.proposed_severity ?? "No severity proposal"}</dd></div></dl>
          {data.acknowledgment ? <p className="text-xs">Acknowledged by {data.acknowledgment.actor_id} at {formatDateTime(data.acknowledgment.occurred_at)}</p> : null}
        </div>
      </OperationsPanel>
      <History key={id + ":occurrences:" + row.revision} id={id} kind="occurrences" />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <OperationsPanel title="Next action" description="Review the exact request before sending. Stale requests require a new review, never automatic token replacement."><div className="p-5"><Actions data={data} onSaved={state.refresh} /></div></OperationsPanel>
        <OperationsPanel title="Linked cases and Work Orders" description="Same-factory authorized targets. COMPLETED orders still await independent verification.">
          <div className="space-y-3 p-5">{data.links.length ? data.links.map(link => {
            const order = data.work_orders.find(o => o.id === link.target_id);
            return <article key={link.id} className="rounded border p-4 text-sm"><p className="font-semibold">{link.type === "case" ? "Decision Case" : "Work Order"} · {link.association_scope}-level association</p>
              {link.type === "case" ? <Link className="mt-2 block break-all text-blue-800 underline" href={"/operations/recommendations?factory_id=" + encodeURIComponent(factoryId) + "&caseId=" + link.target_id}>{link.target_id}</Link> : <p className="mt-2 break-all font-mono">{link.target_id}</p>}
              <p className="mt-2">Target: {link.availability}</p>
              {order ? <div className="mt-3 space-y-2"><OperationsStatus value={order.status} /><p>Machine {order.machine_id} · revision {order.revision}</p><p>Published plan {order.source.published_plan_version} · {order.source_is_current ? "Current publication" : "Historical publication"}</p><p className="break-all text-xs">Assignment {order.source.assignment_id}</p></div> : link.type === "work_order" ? <p className="mt-2 text-amber-800">Target status unavailable. Resolve/close fails closed; an override cannot bypass this.</p> : null}
              <p className="mt-3 break-all text-xs text-stone-500">Linked by {link.created_by} · {formatDateTime(link.created_at)}</p>
            </article>;
          }) : <p className="text-stone-600">No active links. A case or work order is not required for every incident.</p>}</div>
        </OperationsPanel>
      </div>
      {data.resolution || data.closure ? <OperationsPanel title="Latest recorded resolution and verification" description="Prior attempts remain in the audit timeline. Reopening retains historical evidence."><div className="grid gap-4 p-5 md:grid-cols-2">
        {data.resolution ? <article><h3 className="font-semibold">{data.resolution.report.code}</h3><p className="mt-2 whitespace-pre-wrap">{data.resolution.report.summary}</p><p className="mt-2 whitespace-pre-wrap text-sm">{data.resolution.report.evidence}</p><p className="mt-2 break-all text-xs">Resolver {data.resolution.actor_id} · {formatDateTime(data.resolution.occurred_at)}</p></article> : null}
        {data.closure ? <article><h3 className="font-semibold">Independent verification: {data.closure.verification.resolution_code}</h3><p className="mt-2 whitespace-pre-wrap">{data.closure.verification.note}</p><p className="mt-2 break-all text-xs">Verifier {data.closure.actor_id} · {formatDateTime(data.closure.occurred_at)}</p></article> : null}
      </div></OperationsPanel> : null}
      <History key={id + ":events:" + row.revision} id={id} kind="events" />
    </> : null}
  </OperationsShell>;
}
