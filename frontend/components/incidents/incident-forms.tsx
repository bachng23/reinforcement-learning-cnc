"use client";
import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useOperationsAction } from "@/lib/operations-api/use-operations-action";
import { getOperationsActorId } from "@/lib/operations-api/actor";
import { detail, mutate, severities, type Command, type Detail, type Mutation, type Report, type Resolution, type Severity } from "@/lib/incidents/client";

export const inputClass = "mt-1 min-h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600";
export const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <div className="min-w-0 text-sm font-medium"><label htmlFor={id}>{label}</label>
    {Children.map(children, child => isValidElement(child) && typeof child.type === "string"
      && ["input", "select", "textarea"].includes(child.type)
      ? cloneElement(child as ReactElement<{ id?: string }>, { id }) : child)}
  </div>;
}
export function TextField({ label, name, required = true, maxLength = 4000, placeholder }: { label: string; name: string; required?: boolean; maxLength?: number; placeholder?: string }) {
  return <Field label={label}><input name={name} required={required} maxLength={maxLength} placeholder={placeholder} className={inputClass} /></Field>;
}
const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

// Recovery is scoped by factory and incident; actor identity is checked afresh
// before every send. Neither reload nor a failed read automatically repeats a write.
export function IncidentMutationForm({ factoryId, id, build, onSaved, children, disabled = false }: {
  factoryId: string; id?: string; build: (form: FormData) => Mutation;
  onSaved: (id: string) => void; children: ReactNode; disabled?: boolean;
}) {
  const [review, setReview] = useState<Mutation | null>(null);
  const [verificationError, setVerificationError] = useState("");
  const reviewButton = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const action = useOperationsAction<Mutation, Awaited<ReturnType<typeof mutate>>>({
    scope: "incident:" + factoryId + ":" + (id ?? "report"),
    getActorId: getOperationsActorId,
    send: (body, options) => mutate(id, factoryId, body, options),
    onAccepted: async result => {
      setReview(null);
      try {
        const current = await detail(result.data.incident.id, factoryId);
        if (current.data.incident.revision < result.data.incident.revision) throw new Error("Read behind receipt");
        action.acknowledge();
        formRef.current?.reset();
        setVerificationError("");
        onSaved(current.data.incident.id);
      } catch {
        setVerificationError("Write response received, but the confirming read failed. Recover the same receipt before starting another action.");
      }
    },
  });
  useEffect(() => { if (review) reviewButton.current?.focus(); }, [review]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action.hasUnresolvedAction) setReview(build(new FormData(event.currentTarget)));
  }
  return <div className="space-y-4">
    <form ref={formRef} onSubmit={submit}>
      <fieldset disabled={disabled || action.hasUnresolvedAction || Boolean(review)} className="space-y-4">
        {children}
        <button className={buttonClass} type="submit">Review action</button>
      </fieldset>
    </form>
    {review && !action.hasUnresolvedAction ? <section aria-label="Confirm incident action" className="rounded-lg border border-blue-300 bg-blue-50 p-4">
      <h3 className="font-semibold">Review before submitting</h3>
      <p className="mt-2 text-sm">Factory: {factoryId}. {id ? "The reviewed revision is pinned. If it changes, review again." : "This is a new human report, not sensor confirmation."}</p>
      <pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(review.body, null, 2)}</pre>
      <div className="flex gap-3"><button ref={reviewButton} type="button" className={buttonClass} onClick={() => action.start(review)}>Confirm action</button>
        <button type="button" className={buttonClass} onClick={() => { setReview(null); formRef.current?.querySelector<HTMLInputElement>("input,select")?.focus(); }}>Back to edit</button></div>
    </section> : null}
    {action.state.kind !== "idle" ? <div role={["conflict", "error", "unauthorized"].includes(action.state.kind) ? "alert" : "status"} className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
      <p>{action.state.message}</p>{verificationError ? <p>{verificationError}</p> : null}
      {["recoverable", "accepted", "unauthorized"].includes(action.state.kind) ? <button type="button" className={buttonClass + " mt-3"} disabled={action.busy} onClick={action.recover}>Recover original request</button> : null}
      {action.state.kind === "conflict" || action.state.kind === "error" ? <button type="button" className={buttonClass + " mt-3"} onClick={() => { setReview(null); action.acknowledge(); if (id) onSaved(id); }}>Refresh and review</button> : null}
    </div> : null}
  </div>;
}

export function ReportForm({ factoryId, machines, snapshotId, manager, onSaved }: {
  factoryId: string; machines: string[]; snapshotId?: string; manager: boolean; onSaved: (id: string) => void;
}) {
  const [source, setSource] = useState("manual");
  return <IncidentMutationForm factoryId={factoryId} onSaved={onSaved} build={form => {
    const body: Report = { factory_id: factoryId, title: value(form, "title"), description: value(form, "description"),
      category: value(form, "category") as Report["category"],
      source: source === "manual" ? { type: "manual", source_event_id: crypto.randomUUID() } : { type: "case_health_alert", case_id: value(form, "case_id") } };
    if (source === "manual" && value(form, "machine_id") && snapshotId) body.machine = { machine_id: value(form, "machine_id"), basis_snapshot_id: snapshotId };
    if (value(form, "proposed_severity")) body.proposed_severity = value(form, "proposed_severity") as Severity;
    if (value(form, "severity")) body.severity = value(form, "severity") as Severity;
    if (value(form, "related_incident_reason")) body.related_incident_reason = value(form, "related_incident_reason");
    return { operation: "report", body };
  }}>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Report source"><select name="source" value={source} onChange={e => setSource(e.target.value)} className={inputClass}><option value="manual">Manual observation</option><option value="case_health_alert">Existing LIVE health-alert case</option></select></Field>
      <Field label="Category"><select name="category" className={inputClass}>{["EQUIPMENT", "PROCESS", "SAFETY", "OTHER"].map(s => <option key={s}>{s}</option>)}</select></Field>
    </div>
    <TextField label="Title" name="title" maxLength={200} />
    <Field label="Description — your observation"><textarea name="description" required maxLength={4000} rows={3} className={inputClass} /></Field>
    {source === "manual" ? <Field label="Machine (optional)"><select name="machine_id" className={inputClass}><option value="">Factory-level incident</option>{machines.map(m => <option key={m}>{m}</option>)}</select><span className="mt-1 block text-xs text-stone-600">Immutable basis: {snapshotId ?? "Snapshot unavailable; machine-specific report disabled."}</span></Field>
      : <TextField label="LIVE health-alert case ID" name="case_id" maxLength={36} />}
    <div className="grid gap-4 md:grid-cols-2"><Field label="Proposed severity — not confirmed"><select name="proposed_severity" className={inputClass}><option value="">No proposal</option>{severities.map(s => <option key={s}>{s}</option>)}</select></Field>
      {manager ? <Field label="Official severity"><select name="severity" className={inputClass}><option value="">Awaiting confirmation</option>{severities.map(s => <option key={s}>{s}</option>)}</select></Field> : null}</div>
    <TextField label="Reason for a separate incident on an already-reported machine (if applicable)" name="related_incident_reason" required={false} />
  </IncidentMutationForm>;
}

export function CommandForm({ data, manager, onSaved }: { data: Detail; manager: boolean; onSaved: (id: string) => void }) {
  const commands: string[] = [...data.available_commands, ...(manager ? ["LINK", "UNLINK"] : [])];
  const [command, setCommand] = useState(commands[0] ?? "");
  const [source, setSource] = useState("manual");
  const row = data.incident;
  if (!commands.length) return <p className="text-sm text-stone-600">No action available for your role or this state. Server authorization is checked on every request.</p>;
  const reason = ["REASSIGN", "CHANGE_SEVERITY", "REOPEN", "APPEND_OCCURRENCE", "UNLINK"].includes(command);
  return <IncidentMutationForm id={row.id} factoryId={row.factory_id} onSaved={onSaved} disabled={!command} build={form => {
    const expected_revision = row.revision;
    if (command === "LINK") return { operation: "link", body: { expected_revision, target: { type: value(form, "target_type") as "case" | "work_order", id: value(form, "target_id") } } };
    if (command === "UNLINK") return { operation: "unlink", linkId: value(form, "link_id"), body: { expected_revision, reason: value(form, "reason") } };
    let body: Command;
    switch (command) {
      case "ASSIGN": body = { command, expected_revision, owner_user_id: value(form, "owner_user_id") }; break;
      case "REASSIGN": body = { command, expected_revision, owner_user_id: value(form, "owner_user_id"), reason: value(form, "reason") }; break;
      case "CHANGE_SEVERITY": body = { command, expected_revision, severity: value(form, "severity") as Severity, reason: value(form, "reason") }; break;
      case "APPEND_OCCURRENCE": body = { command, expected_revision, reason: value(form, "reason"), source: source === "manual" ? { type: "manual", source_event_id: value(form, "source_event_id") || crypto.randomUUID() } : { type: "case_health_alert", case_id: value(form, "case_id") } }; break;
      case "MARK_RESOLVED": body = { command, expected_revision, resolution: { code: value(form, "resolution_code") as Resolution["code"], summary: value(form, "summary"), evidence: value(form, "evidence") }, ...(value(form, "override") ? { work_order_override_reason: value(form, "override") } : {}) }; break;
      case "CLOSE": body = { command, expected_revision, verification: { resolution_code: value(form, "resolution_code") as Resolution["code"], note: value(form, "note") }, ...(value(form, "override") ? { work_order_override_reason: value(form, "override") } : {}) }; break;
      case "REOPEN": body = { command, expected_revision, reason: value(form, "reason") }; break;
      default: body = { command: command as "ACKNOWLEDGE" | "START_INVESTIGATION", expected_revision };
    }
    return { operation: "command", body };
  }}>
    <Field label="Next action"><select value={command} onChange={e => setCommand(e.target.value)} className={inputClass}>{commands.map(c => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}</select></Field>
    <p className="text-xs text-stone-600">Revision {row.revision}. Commands are server-provided hints, not a grant of permission.</p>
    {["ASSIGN", "REASSIGN"].includes(command) ? <TextField label="Owner user ID — active OPERATOR or ENGINEER in this factory" name="owner_user_id" maxLength={36} /> : null}
    {command === "CHANGE_SEVERITY" ? <Field label="Confirmed severity"><select name="severity" className={inputClass}>{severities.map(s => <option key={s}>{s}</option>)}</select></Field> : null}
    {command === "APPEND_OCCURRENCE" ? <><Field label="Occurrence source"><select value={source} onChange={e => setSource(e.target.value)} className={inputClass}><option value="manual">Manual observation</option><option value="case_health_alert">LIVE health-alert case</option></select></Field>
      {source === "manual" ? <TextField label="Existing source event ID (optional, for deduplication)" name="source_event_id" required={false} maxLength={36} /> : <TextField label="LIVE health-alert case ID" name="case_id" maxLength={36} />}</> : null}
    {["MARK_RESOLVED", "CLOSE"].includes(command) ? <><Field label="Resolution code"><select name="resolution_code" defaultValue={data.resolution?.report.code ?? "FIXED"} className={inputClass}>{["FIXED", "FALSE_POSITIVE", "NO_ACTION_REQUIRED"].map(s => <option key={s}>{s}</option>)}</select></Field>
      {command === "MARK_RESOLVED" ? <><TextField label="Resolution summary" name="summary" /><TextField label="Verification evidence — human report" name="evidence" /></> : <TextField label="Independent verification note" name="note" />}
      {manager ? <TextField label="Nonterminal work-order override reason (optional; unavailable targets cannot be overridden)" name="override" required={false} /> : null}</> : null}
    {command === "LINK" ? <><Field label="Target type"><select name="target_type" className={inputClass}><option value="case">LIVE Decision Case</option><option value="work_order">Work Order</option></select></Field><TextField label="Target ID" name="target_id" maxLength={36} /></> : null}
    {command === "UNLINK" ? <Field label="Link to remove"><select name="link_id" required className={inputClass}><option value="">Choose a link</option>{data.links.map(l => <option key={l.id} value={l.id}>{l.type}: {l.target_id}</option>)}</select></Field> : null}
    {reason ? <TextField label="Reason" name="reason" /> : null}
  </IncidentMutationForm>;
}
