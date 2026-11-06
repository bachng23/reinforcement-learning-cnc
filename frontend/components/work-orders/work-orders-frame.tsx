"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AsyncState } from "@/components/research/async-state";
import type { TokenUser } from "@/lib/auth";
import { errorExplanation, workOrderError, workOrdersApi, type WorkOrdersClient, type WorkOrdersError } from "@/lib/work-orders/client";
import { bindWorkOrderMemory, clearWorkOrderMemory } from "@/lib/work-orders/use-work-order-intent";
import { bindWorkOrderNavigation, clearWorkOrderNavigation, workOrdersHref } from "@/lib/work-orders/navigation";
import type { WorkOrderSummary } from "@/types/generated/work-orders";

export function WorkOrderBadge({ value }: { value: WorkOrderSummary["status"] }) {
  const tone = value === "BLOCKED" || value === "COMPLETED" ? "border-amber-200 bg-amber-50 text-amber-900" : ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(value) ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{value}</span>;
}

export function WorkOrderFailure({ error, retry, cursorReset }: { error: WorkOrdersError; retry?: () => void; cursorReset?: string }) {
  return <div className="space-y-2"><AsyncState kind="error" title={error.status === 404 ? "Work Orders unavailable or inaccessible" : error.status === 401 ? "Sign in required" : error.status === 403 ? "Work Order access denied" : error.code === "INVALID_CURSOR" ? "Pagination must restart" : "Work Orders could not be verified"} description={errorExplanation(error)} onRetry={retry}
    action={error.status === 401 ? <Link href="/login" className="dss-secondary">Sign in</Link> : error.code === "INVALID_CURSOR" && cursorReset ? <Link href={cursorReset} className="dss-secondary">Restart pagination</Link> : undefined} />
    {error.requestId ? <p className="break-all text-xs text-slate-500">Support request ID: <code>{error.requestId}</code></p> : null}</div>;
}

export function WorkOrderAccess({ factoryId, api = workOrdersApi, children }: { factoryId?: string; api?: WorkOrdersClient; children: (actor: TokenUser, fresh: boolean) => ReactNode }) {
  const [identity, setIdentity] = useState<TokenUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<WorkOrdersError>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let generation = 0;
    let controller: AbortController | undefined;
    const check = () => {
      controller?.abort(); controller = new AbortController(); const signal = controller.signal; const serial = ++generation;
      setChecking(true); setError(undefined);
      void api.identity({ signal }).then(user => {
        if (signal.aborted || serial !== generation) return;
        const key = `${user.id}:${user.role}`;
        if (bindWorkOrderMemory(key)) clearWorkOrderNavigation();
        if (factoryId) bindWorkOrderNavigation(`${key}:${factoryId}`);
        setIdentity(user); setChecking(false);
      }).catch((failure: unknown) => {
        if (signal.aborted || serial !== generation) return;
        const failed = workOrderError(failure);
        // A temporary identity read failure cannot prove logout/revocation and
        // must not erase the only original key/body for an uncertain write.
        // Protected children are still unmounted until identity is verified.
        if (failed.status === 401 || failed.status === 403) { clearWorkOrderMemory(); clearWorkOrderNavigation(); }
        setIdentity(null); setError(failed); setChecking(false);
      });
    };
    const visibility = () => { if (document.visibilityState === "visible") check(); else setChecking(true); };
    check(); window.addEventListener("focus", check); document.addEventListener("visibilitychange", visibility);
    return () => { ++generation; controller?.abort(); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", visibility); };
  }, [api, revision, factoryId]);
  return <>
    {checking ? <AsyncState compact kind="loading" title="Verifying workspace access" /> : null}
    {error ? <WorkOrderFailure error={error} retry={() => setRevision(value => value + 1)} /> : null}
    {identity ? <div hidden={checking} key={`${identity.id}:${identity.role}`}>{children(identity, !checking)}</div> : null}
  </>;
}

export function WorkOrdersFrame({ factoryId, title, api = workOrdersApi, children }: { factoryId?: string; title: string; api?: WorkOrdersClient; children: (actor: TokenUser, fresh: boolean) => ReactNode }) {
  return <AppShell title={title} factoryId={factoryId}><main className="mx-auto w-full max-w-[1720px] min-w-0 space-y-5 px-4 py-6 lg:px-8">
    <nav aria-label="Maintenance navigation" className="flex flex-wrap gap-4 text-sm text-blue-700"><Link href={factoryId ? `/overview?factory_id=${encodeURIComponent(factoryId)}` : "/overview"}>Factory Overview</Link><Link href={factoryId ? workOrdersHref({ factory_id: factoryId }) : "/operations/work-orders"}>Work Orders</Link><Link href={factoryId ? `/operations/schedule?factory_id=${encodeURIComponent(factoryId)}` : "/operations/schedule"}>Published schedule</Link></nav>
    <p role="note" className="border-l-4 border-blue-600 bg-blue-50 px-4 py-2 text-xs leading-5 text-blue-950">Live Work Orders API · no fixture fallback. Planned source is immutable; execution does not change telemetry, health, publication or incidents. Draft reports/reasons stay in memory; reloading discards them. Reconcile detail/history before a new intent after an unconfirmed write.</p>
    <WorkOrderAccess factoryId={factoryId} api={api}>{children}</WorkOrderAccess>
  </main></AppShell>;
}

export function CopyIdentity({ value, label = "ID" }: { value: string; label?: string }) {
  const [message, setMessage] = useState("");
  return <span className="inline-flex max-w-full flex-wrap items-center gap-2"><code className="break-all text-xs" title={value}>{value.slice(0, 8)}</code><button type="button" className="rounded border px-2 py-1 text-xs text-blue-700 focus-visible:ring-2" aria-label={`Copy ${label} ${value}`} onClick={() => { void navigator.clipboard?.writeText(value).then(() => setMessage("Copied")).catch(() => setMessage(value)); if (!navigator.clipboard) setMessage(value); }}>Copy</button>{message ? <span role="status" className="break-all text-xs text-slate-500">{message}</span> : null}</span>;
}
