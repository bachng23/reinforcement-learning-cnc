"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { OperationsPanel, OperationsShell, OperationsStatus } from "@/components/operations/operations-shell";
import { ReportForm, buttonClass, inputClass, Field } from "@/components/incidents/incident-forms";
import { list, incidentRequest, statuses, severities, type Counts, type Query } from "@/lib/incidents/client";
import { useIncidentRead } from "@/lib/incidents/use-incident-read";
import { createOperationsApiClient } from "@/lib/operations-api/client";
import { useWorkspaceUser } from "@/lib/workspace-user";
import { formatDateTime } from "@/lib/operations/format";

const live = createOperationsApiClient();
function ReportPanel({ factoryId, onSaved }: { factoryId: string; onSaved: (id: string) => void }) {
  const user = useWorkspaceUser();
  const snapshot = useIncidentRead("report-basis:" + factoryId, signal => live.getOperationsSnapshot(factoryId, { signal }));
  const manager = ["ADMIN", "ENGINEER"].includes(user?.role ?? "");
  if (!user || user.role === "VIEWER") return <p className="p-5 text-sm">Read-only role. Reporting requires OPERATOR, ENGINEER or ADMIN.</p>;
  return <div className="p-5">
    {snapshot.error ? <p role="alert" className="mb-4 text-sm text-amber-800">{snapshot.error} You can still report a factory-level observation or reference an existing case.</p> : null}
    <ReportForm factoryId={factoryId} snapshotId={snapshot.data?.snapshot_id}
      machines={snapshot.data?.snapshot.machines.map(m => m.machine_id) ?? []} manager={manager} onSaved={onSaved} />
  </div>;
}
export function IncidentsPage({ query }: { query: Query }) {
  const router = useRouter();
  const [navigating, transition] = useTransition();
  const [showReport, setShowReport] = useState(false);
  const state = useIncidentRead(JSON.stringify(query), async signal => {
    const [page, counts] = await Promise.all([
      list(query, signal), incidentRequest<Counts>("/incidents/summary?factory_id=" + encodeURIComponent(query.factory_id), { signal }),
    ]);
    if (counts.data.factory_id !== query.factory_id) throw new Error("Summary scope mismatch");
    return { page, counts };
  });
  function navigate(next: Query) {
    const params = new URLSearchParams(Object.entries(next).filter(([, v]) => Boolean(v)) as [string, string][]);
    transition(() => router.push("/operations/incidents?" + params, { scroll: false }));
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    navigate({ factory_id: values.factory_id.trim(), ...Object.fromEntries(Object.entries(values).filter(([k, v]) => k !== "factory_id" && v.trim()).map(([k, v]) => [k, v.trim()])) });
  }
  const data = state.data;
  return <OperationsShell title="Incident Center" description="Accountable investigation, immutable evidence and independent closure."
    factoryId={query.factory_id} dataSource="live" dataSourceMessage="Live factory-scoped incident records. Workflow states do not prove physical recovery. No SLA, inferred severity or fixture fallback."
    actions={<div className="flex gap-2"><button type="button" className={buttonClass} disabled={state.busy} onClick={state.refresh}>Refresh incidents</button><button type="button" className={buttonClass} onClick={() => setShowReport(v => !v)} aria-expanded={showReport}>Report incident</button></div>}>
    {showReport ? <OperationsPanel title="Report an incident" description="Manual observations or an existing LIVE health-alert case. Evidence identity comes from the server.">
      <ReportPanel factoryId={query.factory_id} onSaved={id => router.push("/operations/incidents/" + id + "?factory_id=" + encodeURIComponent(query.factory_id))} />
    </OperationsPanel> : null}
    {data ? <section aria-label="Full factory counts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["All incidents", data.counts.data.total], ["Awaiting severity confirmation", data.counts.data.unconfirmed_severity], ["Unassigned", data.counts.data.unassigned], ["Waiting for verification", data.counts.data.awaiting_verification]].map(([name, count]) =>
        <div key={name} className="rounded-lg border bg-white p-4"><p className="text-xs text-stone-600">{name}</p><p className="mt-2 text-2xl font-semibold">{count}</p></div>)}
      <p className="col-span-full text-xs text-stone-600">Entire factory, independent of filters. {Object.entries(data.counts.data.by_status).map(([s, n]) => s + ": " + n).join(" · ")}</p>
    </section> : null}
    <OperationsPanel title="Search and filters" description="Searches title and description on the server. Filters combine with AND; navigation is stored in the URL.">
      <form onSubmit={apply} className="grid gap-4 p-5 md:grid-cols-3 xl:grid-cols-4">
        <Field label="Factory ID"><input name="factory_id" required defaultValue={query.factory_id} maxLength={128} className={inputClass} /></Field>
        <Field label="Search title or description"><input name="q" defaultValue={query.q} maxLength={200} className={inputClass} /></Field>
        <Field label="Status"><select name="status" defaultValue={query.status ?? ""} className={inputClass}><option value="">All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Severity"><select name="severity" defaultValue={query.severity ?? ""} className={inputClass}><option value="">All severities</option><option value="UNCONFIRMED">Awaiting confirmation</option>{severities.map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Owner user ID"><input name="owner_user_id" defaultValue={query.owner_user_id} maxLength={36} className={inputClass} /></Field>
        <Field label="Machine ID"><input name="machine_id" defaultValue={query.machine_id} maxLength={128} className={inputClass} /></Field>
        <Field label="Page size"><select name="limit" defaultValue={query.limit ?? "25"} className={inputClass}>{["10", "25", "50", "100"].map(n => <option key={n}>{n}</option>)}</select></Field>
        <button type="submit" disabled={navigating} className={buttonClass + " self-end"}>{navigating ? "Applying filters…" : "Apply filters"}</button>
      </form>
    </OperationsPanel>
    {state.busy ? <p role="status">Loading incident records…</p> : null}
    {state.error ? <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-5"><p>{state.error}</p><button type="button" className={buttonClass + " mt-3"} onClick={state.refresh}>Retry read</button></div> : null}
    {data ? <OperationsPanel title="Incident records" description={"Read at " + formatDateTime(data.page.meta.read_at)}>
      {data.page.data.length ? <div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="sticky top-0 bg-stone-100 text-xs uppercase text-stone-600"><tr>{["Incident", "Status / severity", "Owner / machine", "Occurrences", "Last recorded"].map(h => <th key={h} className="px-5 py-3">{h}</th>)}</tr></thead>
        <tbody className="divide-y">{data.page.data.map(row => <tr key={row.id} className="align-top hover:bg-blue-50">
          <td className="max-w-xs px-5 py-4"><Link className="font-semibold text-blue-800 underline focus:ring-2" href={"/operations/incidents/" + row.id + "?factory_id=" + encodeURIComponent(query.factory_id)}>{row.title}</Link><p className="mt-1 break-all font-mono text-xs text-stone-500">{row.id}</p><p className="mt-1 text-xs">{row.category} · {row.source}</p></td>
          <td className="space-y-2 px-5 py-4"><OperationsStatus value={row.status} /><p><OperationsStatus value={row.severity ?? "AWAITING CONFIRMATION"} /></p>{row.proposed_severity ? <p className="text-xs">Proposed: {row.proposed_severity}</p> : null}</td>
          <td className="max-w-48 break-all px-5 py-4"><p>{row.owner_user_id ?? "Unassigned"}</p><p className="mt-2 text-xs">{row.machine?.machine_id ?? "Factory-level"}</p></td>
          <td className="px-5 py-4 tabular-nums">{row.occurrence_count}</td><td className="whitespace-nowrap px-5 py-4 text-xs">{formatDateTime(row.last_occurred_at)}</td>
        </tr>)}</tbody></table></div> : <p className="p-5">No incidents match these filters. This is an empty result, not a service outage.</p>}
      <div className="flex items-center justify-between border-t p-4"><span className="text-xs text-stone-600">{data.page.data.length} records on this page</span><div className="flex gap-3">
        {query.cursor ? <button type="button" className={buttonClass} onClick={() => navigate({ ...query, cursor: undefined })}>First page</button> : null}
        {data.page.meta.has_more && data.page.meta.next_cursor ? <button type="button" className={buttonClass} disabled={navigating} onClick={() => navigate({ ...query, cursor: data.page.meta.next_cursor! })}>Next page</button> : null}
      </div></div>
    </OperationsPanel> : null}
  </OperationsShell>;
}
