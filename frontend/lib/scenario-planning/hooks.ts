"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TokenUser } from "@/lib/auth";
import {
  ScenarioError,
  scenarioError,
  type ScenarioClient,
  type ReadOptions,
  type WriteOptions,
} from "./client";

export function useScenarioRead<T>({
  api,
  actor,
  scope,
  read,
  polling,
  enabled = true,
}: {
  api: ScenarioClient;
  actor: TokenUser;
  scope: string;
  read: (options: ReadOptions) => Promise<T>;
  polling?: (data: T) => boolean;
  enabled?: boolean;
}) {
  const key = `${actor.id}:${actor.role}:${scope}`;
  const [state, setState] = useState<{
    key: string;
    kind: "loading" | "ready" | "error";
    data?: T;
    error?: ScenarioError;
  }>({ key, kind: "loading" });
  const source = useRef({ read, polling, actor });
  source.current = { read, polling, actor };
  const request = useRef<AbortController | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const cancel = useCallback(() => {
    ++generation.current;
    request.current?.abort();
    clearTimeout(timer.current);
  }, []);
  const load = useCallback(
    (delay = 2000) => {
      cancel();
      const serial = generation.current;
      const controller = new AbortController();
      request.current = controller;
      setState((old) => ({
        key,
        kind: "loading",
        ...(enabled && old.key === key ? { data: old.data } : {}),
      }));
      if (!enabled) return;
      const execute = async () => {
        const data = await source.current.read({ signal: controller.signal });
        const current = await api.identity({ signal: controller.signal });
        controller.signal.throwIfAborted();
        if (
          current.id !== source.current.actor.id ||
          current.role !== source.current.actor.role
        )
          throw new ScenarioError(401, "SESSION_CHANGED");
        return data;
      };
      void execute()
        .then((data) => {
          if (controller.signal.aborted || serial !== generation.current)
            return;
          setState({ key, kind: "ready", data });
          if (source.current.polling?.(data))
            timer.current = setTimeout(
              () => load(Math.min(delay * 2, 15000)),
              delay,
            );
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted && serial === generation.current)
            setState({ key, kind: "error", error: scenarioError(failure) });
        });
    },
    [api, key, cancel, enabled],
  );
  useEffect(() => {
    load();
    const refresh = () => load();
    const invalidateAccess = () => {
      setState({ key, kind: "loading" });
      load();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("scenario-access-invalidated", invalidateAccess);
    return () => {
      cancel();
      window.removeEventListener("focus", refresh);
      window.removeEventListener(
        "scenario-access-invalidated",
        invalidateAccess,
      );
    };
  }, [load, cancel, key]);
  return {
    ...(state.key === key ? state : { key, kind: "loading" as const }),
    refresh: () => load(),
  };
}

type FrozenIntent<T> = { key: string; body: T; rejection?: ScenarioError };
export async function verifyScenarioWriteRead<T>(
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (failure: unknown) {
    if ([401, 403].includes(scenarioError(failure).status))
      window.dispatchEvent(new Event("scenario-access-invalidated"));
    throw new ScenarioError(503, "OUTCOME_UNVERIFIED");
  }
}
const intents = new Map<string, FrozenIntent<unknown>>();
let identityScope: string | undefined;
export function clearScenarioMemory() {
  intents.clear();
  identityScope = undefined;
}
export function bindScenarioMemory(actor: TokenUser) {
  const next = `${actor.id}:${actor.role}`;
  if (identityScope !== undefined && next !== identityScope) intents.clear();
  identityScope = next;
}
export function useScenarioIntent<T, R>({
  api,
  actor,
  scope,
  send,
  onAccepted,
  onRejected,
  timeoutMs = 30000,
}: {
  api: ScenarioClient;
  actor: TokenUser;
  scope: string;
  send: (body: T, options: WriteOptions) => Promise<R>;
  onAccepted: (result: R) => void;
  onRejected?: () => void;
  timeoutMs?: number;
}) {
  const key = `${actor.id}:${actor.role}:${scope}`;
  const [state, setState] = useState<{
    kind: "idle" | "pending" | "accepted" | "uncertain" | "rejected";
    error?: ScenarioError;
  }>({ kind: "idle" });
  const active = useRef<FrozenIntent<T> | null>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const locked = useRef(false);
  const callbacks = useRef({ send, onAccepted, onRejected });
  callbacks.current = { send, onAccepted, onRejected };
  const cancel = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    bindScenarioMemory({ id: actor.id, role: actor.role });
    active.current = (intents.get(key) as FrozenIntent<T> | undefined) ?? null;
    locked.current = false;
    setState(
      active.current?.rejection
        ? { kind: "rejected", error: active.current.rejection }
        : { kind: active.current ? "uncertain" : "idle" },
    );
    return cancel;
  }, [key, actor.id, actor.role, cancel]);
  async function execute(intent: FrozenIntent<T>) {
    if (locked.current) return;
    locked.current = true;
    const serial = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    let abortListener: (() => void) | undefined;
    let receipt = false;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(new DOMException("Cancelled", "AbortError"));
      abort.signal.addEventListener("abort", abortListener, { once: true });
    });
    setState({ kind: "pending" });
    try {
      const check = async () => {
        const user = await api.identity({ signal: abort.signal });
        abort.signal.throwIfAborted();
        if (user.id !== actor.id || user.role !== actor.role)
          throw new ScenarioError(401, "SESSION_CHANGED");
      };
      const operation = async () => {
        await check();
        const result = await callbacks.current.send(intent.body, {
          key: intent.key,
          signal: abort.signal,
        });
        receipt = true;
        await check();
        return result;
      };
      const result = await Promise.race([operation(), cancelled]);
      if (serial !== generation.current) return;
      intents.delete(key);
      active.current = null;
      setState({ kind: "accepted" });
      callbacks.current.onAccepted(result);
    } catch (failure: unknown) {
      if (serial !== generation.current) return;
      const error = scenarioError(failure);
      if ([401, 403].includes(error.status))
        window.dispatchEvent(new Event("scenario-access-invalidated"));
      if (error.code === "SESSION_CHANGED") {
        clearScenarioMemory();
        active.current = null;
        setState({ kind: "rejected", error });
      } else if (!receipt && error.status >= 400 && error.status < 500) {
        intent.rejection = error;
        setState({ kind: "rejected", error });
        callbacks.current.onRejected?.();
      } else setState({ kind: "uncertain", error });
    } finally {
      clearTimeout(timeout);
      if (abortListener)
        abort.signal.removeEventListener("abort", abortListener);
      if (serial === generation.current) locked.current = false;
    }
  }
  return {
    state,
    original: active.current?.body,
    busy: state.kind === "pending",
    unresolved: active.current !== null,
    start(body: T) {
      if (locked.current || active.current) return;
      const intent = { key: crypto.randomUUID(), body: structuredClone(body) };
      active.current = intent;
      intents.set(key, intent);
      void execute(intent);
    },
    retry() {
      if (active.current && state.kind === "uncertain")
        void execute(active.current);
    },
    reviewed() {
      if (locked.current || state.kind === "uncertain") return;
      active.current = null;
      intents.delete(key);
      setState({ kind: "idle" });
    },
  };
}

export function useUnsavedScenario(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        link.href === location.href
      )
        return;
      const next = new URL(link.href);
      if (
        next.origin === location.origin &&
        next.pathname === location.pathname
      ) {
        if (next.search === location.search) return;
        // These selections keep the same editor mounted; they do not discard a draft.
        const pinned = [
          "factory_id",
          "scenario_id",
          "draft_cursor",
          "run_cursor",
        ];
        if (
          next.pathname.startsWith("/operations/scenarios/") &&
          pinned.every(
            (name) =>
              next.searchParams.get(name) ===
              new URL(location.href).searchParams.get(name),
          )
        )
          return;
      }
      if (
        !window.confirm(
          "Leave this scenario? Unsaved drafts and uncertain request bodies are memory-only. Reconcile saved records after reload.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
}
