"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TokenUser } from "@/lib/auth";
import { WorkOrdersError, workOrderError, type WorkOrdersClient, type WriteOptions } from "./client";

type Intent<T> = { key: string; body: T; rejection?: WorkOrdersError };
// Reports/reasons NEVER enter browser persistence or log output. SPA navigation
// can recover the frozen request from actor-scoped RAM; hard reload loses drafts.
const pending = new Map<string, Intent<unknown>>();
let boundActor: string | undefined;
export function clearWorkOrderMemory() { pending.clear(); boundActor = undefined; }
export function bindWorkOrderMemory(actor: string) { const changed = boundActor !== undefined && boundActor !== actor; if (changed) pending.clear(); boundActor = actor; return changed; }
export function useWorkOrderIntent<T, R>({ api, actor, scope, send, onAccepted, onRejected, timeoutMs = 30_000 }: {
  api: WorkOrdersClient; actor: TokenUser; scope: string;
  send: (body: T, options: WriteOptions) => Promise<R>; onAccepted: (response: R) => void; onRejected?: (error: WorkOrdersError) => void; timeoutMs?: number;
}) {
  const key = `${actor.id}:${actor.role}:${scope}`;
  const [state, setState] = useState<{ kind: "idle" | "pending" | "uncertain" | "accepted" | "rejected"; error?: WorkOrdersError }>({ kind: "idle" });
  const active = useRef<Intent<T> | null>(null);
  const request = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const cancel = useCallback(() => { ++generation.current; request.current?.abort(); }, []);
  const callbacks = useRef({ send, onAccepted, onRejected }); callbacks.current = { send, onAccepted, onRejected };
  useEffect(() => {
    bindWorkOrderMemory(`${actor.id}:${actor.role}`);
    ++generation.current; locked.current = false;
    active.current = (pending.get(key) as Intent<T> | undefined) ?? null;
    setState(active.current?.rejection ? { kind: "rejected", error: active.current.rejection } : { kind: active.current ? "uncertain" : "idle" });
    return cancel;
  }, [key, cancel, actor.id, actor.role]);
  async function execute(intent: Intent<T>) {
    if (locked.current) return;
    locked.current = true;
    intent.rejection = undefined;
    const serial = generation.current;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let aborted: (() => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => { aborted = () => reject(new DOMException("Request cancelled", "AbortError")); controller.signal.addEventListener("abort", aborted, { once: true }); });
    setState({ kind: "pending" });
    let receiptReceived = false;
    try {
      const operation = async () => {
        const current = await api.identity({ signal: controller.signal });
        if (current.id !== actor.id || current.role !== actor.role) throw new WorkOrdersError(401, "SESSION_CHANGED");
        controller.signal.throwIfAborted();
        const result = await callbacks.current.send(intent.body, { key: intent.key, signal: controller.signal });
        receiptReceived = true;
        const after = await api.identity({ signal: controller.signal });
        if (after.id !== actor.id || after.role !== actor.role) throw new WorkOrdersError(401, "SESSION_CHANGED");
        return result;
      };
      const result = await Promise.race([operation(), cancellation]);
      if (serial !== generation.current) return;
      controller.signal.throwIfAborted();
      setState({ kind: "accepted" });
      // Receipt is historical, never the new authoritative order. Callback only
      // triggers GETs/navigation; no optimistic status/revision update.
      callbacks.current.onAccepted(result);
    } catch (failure: unknown) {
      if (serial !== generation.current) return;
      const error = workOrderError(failure);
      if (error.code === "SESSION_CHANGED") { pending.delete(key); active.current = null; clearWorkOrderMemory(); }
      if ((!receiptReceived || error.code === "SESSION_CHANGED") && error.status >= 400 && error.status < 500) {
        intent.rejection = error;
        setState({ kind: "rejected", error });
        callbacks.current.onRejected?.(error);
      } else setState({ kind: "uncertain", error });
    } finally { clearTimeout(timer); if (aborted) controller.signal.removeEventListener("abort", aborted); if (serial === generation.current) locked.current = false; }
  }
  return {
    state, original: active.current?.body, unresolved: active.current !== null, busy: state.kind === "pending",
    start: (body: T) => {
      if (active.current || locked.current) return;
      const intent = { key: crypto.randomUUID(), body: structuredClone(body) };
      active.current = intent; pending.set(key, intent); void execute(intent);
    },
    retry: () => { if (active.current && !locked.current && state.kind === "uncertain") void execute(active.current); },
    reviewed: () => { if (locked.current || state.kind === "uncertain") return; pending.delete(key); active.current = null; setState({ kind: "idle" }); },
  };
}
