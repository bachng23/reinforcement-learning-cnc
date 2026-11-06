"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TokenUser } from "@/lib/auth";
import type { WorkOrderEvent, WorkOrderEventsResponse } from "@/types/generated/work-orders";
import { WorkOrdersError, workOrderError, type WorkOrdersClient, type RequestOptions } from "./client";

type ReadState<T> = { scope: string; kind: "loading" | "ready" | "error"; data?: T; error?: WorkOrdersError };
export async function verifiedRead<T>(api: WorkOrdersClient, actor: TokenUser, signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  const value = await read();
  const current = await api.identity({ signal });
  signal.throwIfAborted();
  if (current.id !== actor.id || current.role !== actor.role) throw new WorkOrdersError(401, "SESSION_CHANGED");
  return value;
}

export function useWorkOrderRead<T>({ api, actor, scope, read }: { api: WorkOrdersClient; actor: TokenUser; scope: string; read: (options: RequestOptions) => Promise<T> }) {
  const key = `${actor.id}:${actor.role}:${scope}`;
  const callback = useRef(read); callback.current = read;
  const actorRef = useRef(actor); actorRef.current = actor;
  const [state, setState] = useState<ReadState<T>>({ scope: key, kind: "loading" });
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const cancel = useCallback(() => { ++generation.current; request.current?.abort(); }, []);
  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const serial = ++generation.current;
    setState(old => ({ scope: key, kind: "loading", ...(old.scope === key ? { data: old.data } : {}) }));
    void verifiedRead(api, actorRef.current, controller.signal, () => callback.current({ signal: controller.signal })).then(data => {
      if (!controller.signal.aborted && serial === generation.current) setState({ scope: key, kind: "ready", data });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || serial !== generation.current) return;
      // Never keep reports/rows on access loss or malformed/mixed context.
      setState({ scope: key, kind: "error", error: workOrderError(failure) });
    });
  }, [api, key]); // Actor identity fields are included in the key.
  useEffect(() => {
    refresh();
    const invalidated = () => refresh();
    window.addEventListener("work-orders-changed", invalidated);
    window.addEventListener("focus", invalidated);
    return () => { cancel(); window.removeEventListener("work-orders-changed", invalidated); window.removeEventListener("focus", invalidated); };
  }, [refresh, cancel]);
  return { state: state.scope === key ? state : { scope: key, kind: "loading" as const }, refresh };
}

export function useWorkOrderEvents({ api, actor, id, factoryId, refreshToken }: { api: WorkOrdersClient; actor: TokenUser; id: string; factoryId: string; refreshToken: string }) {
  const scope = `${actor.id}:${actor.role}:${factoryId}:${id}`;
  const [state, setState] = useState<{ scope: string; events: WorkOrderEvent[]; meta?: WorkOrderEventsResponse["meta"]; busy: boolean; error?: WorkOrdersError; pages: number }>({ scope, events: [], busy: true, pages: 0 });
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const actorRef = useRef(actor); actorRef.current = actor;
  const cancel = useCallback(() => { ++generation.current; active.current?.abort(); }, []);
  const loadedPages = useRef(1);
  const load = useCallback((append: boolean, after = 0) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const serial = ++generation.current;
    setState(old => old.scope === scope ? { ...old, busy: true, error: undefined } : { scope, events: [], busy: true, pages: 0 });
    void verifiedRead(api, actorRef.current, controller.signal, async () => {
      let cursor = after;
      let meta: WorkOrderEventsResponse["meta"] | undefined;
      const events: WorkOrderEvent[] = [];
      let pages = 0;
      do {
        const response = await api.events(id, cursor, 100, { signal: controller.signal });
        events.push(...response.data); meta = response.meta; pages++;
        cursor = meta.next_after_sequence ?? cursor;
      } while (!append && meta.has_more && pages < loadedPages.current);
      return { events, meta, pages };
    }).then(result => {
      if (controller.signal.aborted || serial !== generation.current) return;
      loadedPages.current = append ? loadedPages.current + result.pages : result.pages;
      setState(old => ({ scope, events: append && old.scope === scope ? [...old.events, ...result.events] : result.events, meta: result.meta, pages: loadedPages.current, busy: false }));
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || serial !== generation.current) return;
      // A failed refresh is not an empty or complete history.
      setState({ scope, events: [], busy: false, pages: 0, error: workOrderError(failure) });
    });
  }, [api, id, scope]);
  useEffect(() => { loadedPages.current = 1; }, [scope]);
  useEffect(() => { load(false); return cancel; }, [load, refreshToken, cancel]);
  return { ...state, ...(state.scope === scope ? {} : { events: [], meta: undefined, busy: true, error: undefined, pages: 0 }), refresh: () => load(false), loadMore: () => { if (!state.busy && state.meta?.has_more) load(true, state.meta.next_after_sequence ?? 0); } };
}
