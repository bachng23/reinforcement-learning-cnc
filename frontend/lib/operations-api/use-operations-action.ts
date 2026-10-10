"use client";

import { useEffect, useRef, useState } from "react";

import { OperationsApiError, type OperationsWriteOptions } from "./client";

export type OperationsAction<T> = { key: string; body: T; actorId?: string };
export type OperationsActionState<T> =
  | { kind: "idle" }
  | { kind: "pending" | "recoverable" | "accepted"; action: OperationsAction<T>; message: string }
  | { kind: "conflict" | "unauthorized" | "error"; message: string };

/** A journal is recovery information, never authority. Mount/reload never sends a POST. */
export function useOperationsAction<TBody, TResult>({
  scope, send, onAccepted, onConflict, getActorId, requestTimeoutMs = 30_000,
}: {
  scope: string;
  send: (body: TBody, options: OperationsWriteOptions) => Promise<TResult>;
  onAccepted: (result: TResult) => void;
  onConflict?: () => void;
  getActorId?: (options: OperationsWriteOptions) => Promise<string>;
  requestTimeoutMs?: number;
}) {
  const storageKey = `operations-action:v1:${scope}`;
  const [state, setState] = useState<OperationsActionState<TBody>>({ kind: "idle" });
  const active = useRef<OperationsAction<TBody> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const callbacks = useRef({ send, onAccepted, onConflict, getActorId });
  callbacks.current = { send, onAccepted, onConflict, getActorId };

  useEffect(() => {
    mounted.current = true;
    active.current = null;
    locked.current = false;
    setState({ kind: "idle" });
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved === "object" && "key" in saved && "body" in saved
        && typeof saved.key === "string" && /^[\x21-\x7e]{1,128}$/.test(saved.key)) {
        active.current = saved as OperationsAction<TBody>;
        setState({ kind: "recoverable", action: active.current, message: "A previous response was not confirmed. Recover with the original request before starting another action." });
      }
    } catch { /* Storage can be disabled; in-memory recovery still works. */ }
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [storageKey]);

  const clearJournal = () => {
    active.current = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* In-memory journal remains authoritative for this session. */ }
  };

  const execute = async (action: OperationsAction<TBody>) => {
    if (locked.current) return;
    locked.current = true;
    const request = new AbortController();
    controller.current = request;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, requestTimeoutMs);
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(new DOMException("Request cancelled", "AbortError"));
      request.signal.addEventListener("abort", abortListener, { once: true });
    });
    setState({ kind: "pending", action, message: "Submitting. Wait for the authoritative response." });
    try {
      const options = { idempotencyKey: action.key, signal: request.signal };
      const actorId = callbacks.current.getActorId ? await Promise.race([callbacks.current.getActorId(options), aborted]) : "preview";
      request.signal.throwIfAborted();
      if (action.actorId && action.actorId !== actorId) throw new OperationsApiError(403, null);
      action.actorId = actorId;
      try { sessionStorage.setItem(storageKey, JSON.stringify(action)); } catch { /* Keep actor/key/body in memory. */ }
      const result = await Promise.race([callbacks.current.send(action.body, options), aborted]);
      if (!mounted.current || request.signal.aborted) return;
      // Keep the receipt key until the subsequent authoritative read is verified.
      setState({ kind: "accepted", action, message: "Response received. Refreshing authoritative state." });
      locked.current = false;
      callbacks.current.onAccepted(result);
    } catch (error: unknown) {
      if (!mounted.current || (request.signal.aborted && !timedOut)) return;
      if (error instanceof OperationsApiError && error.status === 409) {
        clearJournal();
        setState({ kind: "conflict", message: "The context or decision changed. Refresh and review again; this request will not be resubmitted with new tokens." });
        callbacks.current.onConflict?.();
      } else if ((error instanceof OperationsApiError && [401, 403].includes(error.status))
        || (error instanceof Error && error.name === "AuthRedirectError")) {
        setState({ kind: "unauthorized", message: "Sign in with decision permission. The original request is retained for recovery." });
      } else if (error instanceof OperationsApiError && error.status >= 400 && error.status < 500) {
        clearJournal();
        setState({ kind: "error", message: error.apiError?.message ?? error.contractError?.message ?? "The backend rejected this request." });
      } else {
        setState({ kind: "recoverable", action, message: "The response was not confirmed. The action may have succeeded. Recover its outcome using the same key and body." });
      }
    } finally {
      clearTimeout(timer);
      if (abortListener) request.signal.removeEventListener("abort", abortListener);
      locked.current = false;
    }
  };

  const start = (body: TBody) => {
    if (locked.current || active.current) return;
    const action = { key: crypto.randomUUID(), body: structuredClone(body) };
    active.current = action;
    try { sessionStorage.setItem(storageKey, JSON.stringify(action)); } catch { /* Keep the request in memory. */ }
    void execute(action);
  };
  const recover = () => {
    if (active.current && !locked.current) void execute(active.current);
  };
  const acknowledge = () => {
    if (locked.current) return;
    clearJournal();
    setState({ kind: "idle" });
  };

  return { state, start, recover, acknowledge, busy: state.kind === "pending", hasUnresolvedAction: active.current !== null };
}
