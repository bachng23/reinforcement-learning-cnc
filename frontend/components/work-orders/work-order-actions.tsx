"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TokenUser } from "@/lib/auth";
import { buildWorkOrderCommand, commandLabels, emptyCommandDraft, needsAssignee, WorkOrderFormError, type CommandDraft, type CommandName } from "@/lib/work-orders/commands";
import { useWorkOrderIntent } from "@/lib/work-orders/use-work-order-intent";
import { errorExplanation, WorkOrdersError, type WorkOrdersClient } from "@/lib/work-orders/client";
import type { WorkOrderAssignee, WorkOrderCommandRequest, WorkOrderResponse } from "@/types/generated/work-orders";

export function WorkOrderActions({ api, actor, response, fresh, refresh, assigneeOptions: injectedOptions, primaryTargetId }: {
  api: WorkOrdersClient; actor: TokenUser; response: WorkOrderResponse; fresh: boolean; refresh: () => void;
  /** Component harness injection only; production always reads the scoped directory. */
  assigneeOptions?: Pick<NonNullable<WorkOrderAssignee>, "user_id" | "username">[];
  primaryTargetId?: string;
}) {
  const order = response.data;
  const [liveOptions, setLiveOptions] = useState<Pick<NonNullable<WorkOrderAssignee>, "user_id" | "username">[]>();
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerAfter, setPickerAfter] = useState<string>();
  const [pickerNext, setPickerNext] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState("");
  const assigneeOptions = injectedOptions ?? liveOptions;
  useEffect(() => {
    if (injectedOptions || !fresh || !["ADMIN", "ENGINEER"].includes(actor.role)) { setLiveOptions(undefined); return; }
    const controller = new AbortController(); setLiveOptions(undefined); setPickerNext(null); setPickerError("");
    api.eligibleAssignees(order.factory_id, pickerQuery, pickerAfter, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setLiveOptions(result.data); setPickerNext(result.meta.next_after); }
    }).catch(error => { if (!controller.signal.aborted) setPickerError(errorExplanation(error)); });
    return () => controller.abort();
  }, [api, actor.id, actor.role, fresh, order.factory_id, response, injectedOptions, pickerQuery, pickerAfter]);
  const [form, setForm] = useState<{ command: CommandName; revision: number } | null>(null);
  const [draft, setDraft] = useState<CommandDraft>(emptyCommandDraft);
  const [validation, setValidation] = useState("");
  const [invalidField, setInvalidField] = useState<keyof CommandDraft>();
  const [primaryHost, setPrimaryHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setPrimaryHost(primaryTargetId ? document.getElementById(primaryTargetId) : null); }, [primaryTargetId]);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const awaitingRead = useRef<WorkOrderResponse | null>(null);
  const intent = useWorkOrderIntent<WorkOrderCommandRequest, WorkOrderResponse>({ api, actor, scope: `command:${order.factory_id}:${order.id}`,
    send: async (body, options) => {
      const result = await api.command(order.id, body, options);
      if (result.data.id !== order.id || result.data.factory_id !== order.factory_id) throw new WorkOrdersError(502, "INVALID_RESPONSE");
      return result;
    },
    onAccepted: () => { awaitingRead.current = response; setForm(null); refresh(); window.dispatchEvent(new Event("work-orders-changed")); },
    onRejected: () => { setForm(null); refresh(); },
  });
  // Recovery controls live on detail. Remove the modal's top layer on an
  // unconfirmed outcome so keyboard/pointer users can reach the exact replay.
  // The draft and frozen intent remain in memory; no new request is started.
  useEffect(() => { if (intent.state.kind === "uncertain") setForm(null); }, [intent.state.kind]);
  useEffect(() => {
    if (intent.state.kind === "accepted" && fresh && awaitingRead.current && awaitingRead.current !== response) {
      intent.reviewed(); awaitingRead.current = null; setDraft(emptyCommandDraft);
    }
  }, [fresh, intent, response]);
  useEffect(() => {
    if (!form || !dialog.current) return;
    if (!fresh) { if (typeof dialog.current.close === "function") dialog.current.close(); else dialog.current.removeAttribute("open"); return; }
    if (typeof dialog.current.showModal === "function" && !dialog.current.open) dialog.current.showModal();
    else dialog.current.setAttribute("open", "");
    return () => { requestAnimationFrame(() => trigger.current?.focus()); };
  }, [form, fresh]);
  const dirty = Boolean(form && (draft.reason || draft.work || draft.result || draft.stopReason || draft.note));
  useEffect(() => {
    if (!dirty && !intent.unresolved) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || !(link instanceof HTMLAnchorElement) || link.target === "_blank" || event.ctrlKey || event.metaKey || link.href === window.location.href) return;
      if (!window.confirm("Leave this form? Reports/reasons are memory-only. An unconfirmed request may already have committed; reconcile detail/history before another intent.")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, intent.unresolved]);
  const available = actor.role === "VIEWER" ? [] : order.available_commands;
  const preferred: CommandName[] = ["COMPLETE", "START", "ACCEPT", "CLOSE", "ASSIGN", "RESUME", "MANAGER_HOLD", "REQUEST_REWORK", "REASSIGN_FOR_REWORK", "REASSIGN", "BLOCK", "CANCEL"];
  const primary = preferred.find(command => available.includes(command));
  const blocked = !fresh || intent.busy || intent.unresolved;
  const selfVerification = (command: CommandName) => ["CLOSE", "REQUEST_REWORK", "REASSIGN_FOR_REWORK"].includes(command) && order.latest_completion?.actor_id === actor.id;
  const permitted = (command: CommandName) => available.includes(command) && !selfVerification(command) && (!needsAssignee(command) || assigneeOptions !== undefined);
  const fieldAttrs = (field: keyof CommandDraft) => ({ name: `wo-${field}`, disabled: !fresh || intent.busy || intent.unresolved, "aria-invalid": invalidField === field || undefined, "aria-describedby": invalidField === field ? "wo-command-error" : undefined });
  const open = (command: CommandName) => {
    if (blocked || !permitted(command)) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValidation("");
    if (command === "ACCEPT" || command === "START") intent.start(buildWorkOrderCommand(command, order.revision, draft));
    else { setDraft(old => ({ ...old, verification: order.latest_completion?.report.outcome === "STOPPED" ? "VERIFIED_STOPPED" : "VERIFIED" })); setForm({ command, revision: order.revision }); }
  };
  const close = () => { if (intent.busy) return; if (dirty && !window.confirm("Close the form? The draft stays in memory only until you leave/reload this detail.")) return; setForm(null); };
  return <section aria-label="Work Order commands" className="rounded-lg border bg-white p-5">
    {primaryHost && primary ? createPortal(<div className="space-y-2"><button className="dss-primary" disabled={blocked || !permitted(primary)} onClick={() => open(primary)}>{commandLabels[primary]}</button>{needsAssignee(primary) && assigneeOptions === undefined ? <p className="max-w-56 text-xs text-amber-900">Loading eligible assignees</p> : null}</div>, primaryHost) : null}
    <h2 className="text-base font-semibold">Next action</h2><p className="mt-2 text-xs text-slate-500">Commands are returned by the backend for the current user and state. They can still be rejected if access, assignee or revision changes.</p>
    {!fresh ? <p role="status" className="mt-3 text-sm text-amber-800">Refreshing authoritative detail. Commands are disabled.</p> : null}
    {actor.role === "VIEWER" ? <p className="mt-4 text-sm">VIEWER access is read-only.</p> : available.length ? <div className="mt-4 flex flex-wrap gap-2">{available.filter(command => !primaryHost || command !== primary).map(command => <button key={command} className={!primaryHost && command === primary && command !== "CANCEL" ? "dss-primary" : "dss-secondary"} disabled={blocked || !permitted(command)} title={needsAssignee(command) && assigneeOptions === undefined ? "Eligible assignees are loading or unavailable. Refresh access before assigning." : undefined} onClick={() => open(command)}>{commandLabels[command]}</button>)}</div> : <p className="mt-4 text-sm text-slate-500">No commands are available for your current access and this order state.</p>}
    {available.some(needsAssignee) && assigneeOptions === undefined ? <p role="note" className="mt-3 border-l-2 border-amber-500 pl-3 text-xs leading-5 text-amber-900">Eligible assignees are loading or unavailable. Refresh access before assigning.</p> : null}
    {intent.state.kind === "pending" ? <p role="status" aria-live="polite" className="mt-4 text-sm">Submitting original intent… Double submission is blocked.</p> : null}
    {intent.state.kind === "accepted" ? <p role="status" className="mt-4 text-sm">Receipt received. Re-reading authoritative detail/history; receipt replay is not the current state.</p> : null}
    {intent.state.error ? <p role="alert" className="mt-4 break-words text-sm text-rose-800">{errorExplanation(intent.state.error)}{intent.state.error.requestId ? <code className="ml-2 break-all text-xs">Request {intent.state.error.requestId}</code> : null}</p> : null}
    {intent.state.kind === "uncertain" ? <div className="mt-4 space-y-3 rounded-md bg-amber-50 p-4"><p className="text-sm text-amber-900">Outcome unconfirmed. The original key, body and revision are retained in memory. No different intent can be sent. Hard reload discards the request body; reconcile reads/history first.</p><div className="flex gap-2"><button className="dss-primary" disabled={!fresh || intent.busy} onClick={intent.retry}>Retry original intent</button><button className="dss-secondary" onClick={refresh}>Reconcile detail and history</button></div></div> : null}
    {intent.state.kind === "rejected" ? <div className="mt-4 flex flex-wrap gap-2"><button className="dss-secondary" disabled={!fresh} onClick={() => intent.reviewed()}>I reviewed the refreshed order</button><button className="dss-secondary" onClick={refresh}>Refresh for review</button><p className="w-full text-xs text-slate-500">A new intent needs explicit review and a new key. The old request is never updated with a new revision.</p></div> : null}
    {form ? <dialog ref={dialog} aria-labelledby="wo-command-title" onCancel={event => { event.preventDefault(); close(); }} className="fixed inset-0 z-50 m-auto max-h-[90vh] w-[calc(100%-3rem)] max-w-2xl overflow-y-auto rounded-xl border bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><form className="space-y-4" onSubmit={event => {
      event.preventDefault();
      if (blocked || !permitted(form.command) || order.revision !== form.revision) return;
      if (needsAssignee(form.command) && !assigneeOptions?.some(user => user.user_id === draft.assignee)) { setValidation("Choose a currently eligible assignee."); return; }
      try { setValidation(""); intent.start(buildWorkOrderCommand(form.command, form.revision, draft)); }
      catch (error: unknown) { setValidation(error instanceof Error ? error.message : "Review the required fields."); if (error instanceof WorkOrderFormError) { setInvalidField(error.field); dialog.current?.querySelector<HTMLElement>(`[name="wo-${error.field}"]`)?.focus(); } }
    }}><h2 id="wo-command-title" className="text-lg font-semibold">{commandLabels[form.command]}</h2><p className="text-sm">{order.machine_id} · {order.maintenance_request_id} · order {order.id.slice(0, 8)} · revision {form.revision}</p>
      {form.command === "MANAGER_HOLD" ? <p className="rounded bg-amber-50 p-3 text-sm">This is an audited managerial hold, not a BLOCK attributed to the assignee. It preserves original execution timestamps and does not assert physical stoppage.</p> : null}
      {form.command === "REQUEST_REWORK" || form.command === "REASSIGN_FOR_REWORK" ? <p className="text-sm">Independent review opens a new attempt and retains old reports/start time. Reassignment requires the replacement to ACCEPT then START.</p> : null}
      {form.command === "CLOSE" ? <div className="space-y-2 rounded border bg-slate-50 p-4 text-sm"><h3 className="font-semibold">Latest completion to verify</h3><p>{order.latest_completion?.report.outcome ?? "Not provided"} · reporter {order.latest_completion?.actor_id ?? "Not provided"}</p><p className="whitespace-pre-wrap break-words">{order.latest_completion?.report.work_performed}</p><p className="whitespace-pre-wrap break-words">{order.latest_completion?.report.result}</p>{order.latest_completion?.report.stop_reason ? <p>Stop reason: {order.latest_completion.report.stop_reason}</p> : null}<p className="text-xs text-slate-500">Closure records independent verification; it does not declare the machine recovered.</p></div> : null}
      {needsAssignee(form.command) ? <div className="space-y-2"><label>Search eligible assignees<input className="dss-input" disabled={intent.busy || intent.unresolved} value={pickerQuery} onChange={event => { setPickerQuery(event.target.value); setPickerAfter(undefined); setDraft(old => ({ ...old, assignee: "" })); }} /></label>{pickerAfter ? <button type="button" className="dss-secondary" disabled={intent.busy || intent.unresolved} onClick={() => { setPickerAfter(undefined); setDraft(old => ({ ...old, assignee: "" })); }}>First assignee page</button> : null}{pickerNext ? <button type="button" className="dss-secondary" disabled={intent.busy || intent.unresolved} onClick={() => { setPickerAfter(pickerNext); setDraft(old => ({ ...old, assignee: "" })); }}>More assignees</button> : null}{pickerError ? <p role="alert">{pickerError}</p> : null}</div> : null}
      {needsAssignee(form.command) ? <label className="block text-sm font-medium">Eligible assignee<select aria-label="Eligible assignee" {...fieldAttrs("assignee")} className="dss-input mt-1" required value={draft.assignee} onChange={event => setDraft(old => ({ ...old, assignee: event.target.value }))}><option value="">Choose assignee</option>{assigneeOptions?.map(user => <option key={user.user_id} value={user.user_id}>{user.username}</option>)}</select></label> : null}
      {!["ASSIGN", "COMPLETE", "CLOSE"].includes(form.command) ? <label className="block text-sm font-medium">Reason<textarea {...fieldAttrs("reason")} required maxLength={4000} rows={3} className="dss-input mt-1 py-2" value={draft.reason} onChange={event => setDraft(old => ({ ...old, reason: event.target.value }))} /></label> : null}
      {form.command === "COMPLETE" ? <><label className="block text-sm font-medium">Outcome<select aria-label="Outcome" {...fieldAttrs("outcome")} className="dss-input mt-1" value={draft.outcome} onChange={event => setDraft(old => ({ ...old, outcome: event.target.value as CommandDraft["outcome"] }))}><option>SUCCESS</option><option>PARTIAL</option><option>STOPPED</option></select></label><label className="block text-sm font-medium">Work performed<textarea {...fieldAttrs("work")} required rows={3} maxLength={4000} className="dss-input mt-1 py-2" value={draft.work} onChange={event => setDraft(old => ({ ...old, work: event.target.value }))} /></label><label className="block text-sm font-medium">Result<textarea {...fieldAttrs("result")} required rows={3} maxLength={4000} className="dss-input mt-1 py-2" value={draft.result} onChange={event => setDraft(old => ({ ...old, result: event.target.value }))} /></label>{draft.outcome === "STOPPED" ? <label className="block text-sm font-medium">Stop reason (required)<textarea {...fieldAttrs("stopReason")} required rows={2} maxLength={4000} className="dss-input mt-1 py-2" value={draft.stopReason} onChange={event => setDraft(old => ({ ...old, stopReason: event.target.value }))} /></label> : null}</> : null}
      {form.command === "CLOSE" ? <><label className="block text-sm font-medium">Verification result<select aria-label="Verification result" {...fieldAttrs("verification")} className="dss-input mt-1" value={draft.verification} onChange={event => setDraft(old => ({ ...old, verification: event.target.value as CommandDraft["verification"] }))}><option value={order.latest_completion?.report.outcome === "STOPPED" ? "VERIFIED_STOPPED" : "VERIFIED"}>{order.latest_completion?.report.outcome === "STOPPED" ? "VERIFIED_STOPPED" : "VERIFIED"}</option></select></label><label className="block text-sm font-medium">Verification note<textarea {...fieldAttrs("note")} required maxLength={4000} rows={3} className="dss-input mt-1 py-2" value={draft.note} onChange={event => setDraft(old => ({ ...old, note: event.target.value }))} /></label></> : null}
      {order.revision !== form.revision ? <p role="alert" className="text-sm text-amber-900">The order changed while this form was open. Close, refresh and review. This draft is not rebased automatically.</p> : null}
      {validation ? <p id="wo-command-error" role="alert" className="text-sm text-rose-800">{validation}</p> : null}
      {intent.busy ? <p role="status">Submitting…</p> : null}
      <div className="flex justify-end gap-2"><button className="dss-secondary" type="button" disabled={intent.busy} onClick={close}>Close form</button><button type="submit" className="dss-primary" disabled={blocked || !permitted(form.command) || order.revision !== form.revision}>{intent.busy ? "Submitting…" : `Confirm ${commandLabels[form.command].toLowerCase()}`}</button></div>
    </form></dialog> : null}
  </section>;
}
