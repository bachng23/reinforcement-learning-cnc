"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AsyncState } from "@/components/research/async-state";
import type { TokenUser } from "@/lib/auth";
import {
  scenarioApi,
  ScenarioError,
  scenarioError,
  scenarioErrorText,
  type ScenarioClient,
} from "@/lib/scenario-planning/client";
import {
  bindScenarioMemory,
  clearScenarioMemory,
} from "@/lib/scenario-planning/hooks";
import { scenarioHref } from "@/lib/scenario-planning/navigation";

export const scenarioInput = "dss-input mt-1";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
export function Dependency({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
      role="note"
    >
      <h3 className="font-semibold">{title}</h3>
      <div className="leading-6">{children}</div>
    </div>
  );
}
export function ScenarioFailure({
  error,
  retry,
}: {
  error: ScenarioError;
  retry?: () => void;
}) {
  const title =
    error.status === 401
      ? "Sign in required"
      : error.status === 403
        ? "Scenario access denied"
        : error.status === 404
          ? "Scenario service or workspace unavailable"
          : error.status === 409
            ? "Review current state"
            : error.status === 0
              ? "Scenario network error"
              : "Scenario data unavailable";
  return (
    <div className="space-y-2">
      <AsyncState
        compact
        kind="error"
        title={title}
        description={scenarioErrorText(error)}
        onRetry={retry}
      />
      {error.requestId ? (
        <p className="break-all text-xs text-slate-500">
          Support request: {error.requestId}
        </p>
      ) : null}
      {error.status === 401 ? (
        <Link href="/login" className="dss-secondary">
          Sign in
        </Link>
      ) : null}
    </div>
  );
}
export function ScenarioFrame({
  factoryId,
  api = scenarioApi,
  children,
}: {
  factoryId: string;
  api?: ScenarioClient;
  children: (actor: TokenUser, fresh: boolean) => ReactNode;
}) {
  const [state, setState] = useState<{
    actor?: TokenUser;
    checking: boolean;
    error?: ScenarioError;
  }>({ checking: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let generation = 0;
    let request: AbortController | undefined;
    const verify = () => {
      request?.abort();
      request = new AbortController();
      const signal = request.signal;
      const serial = ++generation;
      setState((old) => ({ actor: old.actor, checking: true }));
      void api
        .identity({ signal })
        .then((actor) => {
          if (signal.aborted || serial !== generation) return;
          bindScenarioMemory(actor);
          setState({ actor, checking: false });
        })
        .catch((failure: unknown) => {
          if (signal.aborted || serial !== generation) return;
          const error = scenarioError(failure);
          if ([401, 403].includes(error.status)) clearScenarioMemory();
          setState({ checking: false, error });
        });
    };
    const visibility = () => {
      if (document.visibilityState === "visible") verify();
      else setState((old) => ({ ...old, checking: true }));
    };
    verify();
    window.addEventListener("focus", verify);
    window.addEventListener("scenario-access-invalidated", verify);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      ++generation;
      request?.abort();
      window.removeEventListener("focus", verify);
      window.removeEventListener("scenario-access-invalidated", verify);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [api, revision, factoryId]);
  return (
    <AppShell title="Scenario Planning" factoryId={factoryId}>
      <main className="mx-auto min-w-0 max-w-[1720px] space-y-5 px-5 py-6 lg:px-8">
        <nav
          aria-label="Scenario navigation"
          className="flex flex-wrap gap-4 text-sm text-blue-800"
        >
          <Link href={`/overview?factory_id=${encodeURIComponent(factoryId)}`}>
            Factory Overview
          </Link>
          <Link href={scenarioHref(factoryId)}>Scenario workspaces</Link>
        </nav>
        {state.checking ? (
          <AsyncState
            compact
            kind="loading"
            title="Verifying Scenario Planning access"
          />
        ) : null}
        {state.error ? (
          <ScenarioFailure
            error={state.error}
            retry={() => setRevision((n) => n + 1)}
          />
        ) : null}
        {state.actor ? (
          <div
            hidden={state.checking}
            key={`${state.actor.id}:${state.actor.role}:${factoryId}`}
          >
            {children(state.actor, !state.checking)}
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
export function IdentityDetails({
  values,
}: {
  values: Record<string, string | number | null | undefined>;
}) {
  return (
    <details className="rounded-lg border bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold focus-visible:ring-2">
        Technical identities and provenance
      </summary>
      <dl className="mt-4 grid gap-4 text-xs lg:grid-cols-2">
        {Object.entries(values).map(([label, value]) => (
          <div key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd className="mt-1 break-all font-mono">
              {value ?? "Not provided"}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
export function ScenarioDialog({
  title,
  open,
  fresh,
  busy,
  children,
  onClose,
  onConfirm,
  confirmLabel,
}: {
  title: string;
  open: boolean;
  fresh: boolean;
  busy: boolean;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open || !dialog.current) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!fresh) {
      dialog.current.close?.();
      return;
    }
    if (typeof dialog.current.showModal === "function") {
      if (!dialog.current.open) dialog.current.showModal();
    } else dialog.current.setAttribute("open", "");
    return () => {
      requestAnimationFrame(() => previous?.focus());
    };
  }, [open, fresh]);
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 z-50 m-auto max-h-[90vh] w-[calc(100%-3rem)] max-w-3xl overflow-y-auto rounded-xl border bg-white p-6 shadow-xl backdrop:bg-slate-950/40"
    >
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="my-5 space-y-4">{children}</div>
      {busy ? (
        <p role="status" className="mb-4 text-sm">
          Submitting original intent…
        </p>
      ) : null}
      <div className="flex justify-end gap-3">
        <button className="dss-secondary" disabled={busy} onClick={onClose}>
          Back to editor
        </button>
        <button
          className="dss-primary"
          disabled={!fresh || busy}
          onClick={onConfirm}
        >
          {busy ? "Submitting…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
