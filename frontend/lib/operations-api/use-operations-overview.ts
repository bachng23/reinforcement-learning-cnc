"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OperationsApiError, type OperationsApiClient } from "./client";
import { OverviewContextMismatchError, OverviewIntegrityError, validateOverview, type OperationsOverview } from "./overview";

type FailureKind = "unauthorized" | "forbidden" | "not-found" | "unavailable" | "network-error" | "integrity-error" | "context-mismatch" | "error";
const messages: Record<FailureKind, string> = {
  unauthorized: "Sign in to view this factory.",
  forbidden: "You do not have permission to view this factory.",
  "not-found": "Factory context is unavailable: no snapshot exists or the factory is not accessible.",
  unavailable: "The Overview service is temporarily unavailable. Retry later.",
  "network-error": "Overview could not be reached. Check your connection and retry.",
  "integrity-error": "Overview data is incomplete or inconsistent. Data is hidden; refresh to try again.",
  "context-mismatch": "Overview belongs to a different context. Data is hidden; review the factory and refresh.",
  error: "Overview could not be read safely. Refresh to try again.",
};
export type OperationsOverviewState = { factoryId: string } & (
  | { kind: "loading" | "missing-factory"; data: null }
  | { kind: "ready"; data: OperationsOverview }
  | { kind: FailureKind; data: null; message: string }
);
function failure(error: unknown): FailureKind {
  if (error instanceof OverviewContextMismatchError) return "context-mismatch";
  if (error instanceof OverviewIntegrityError || error instanceof SyntaxError) return "integrity-error";
  if (error instanceof Error && error.name === "AuthRedirectError") return "unauthorized";
  if (error instanceof OperationsApiError) {
    if (error.status === 401) return "unauthorized";
    if (error.status === 403) return "forbidden";
    // Contract intentionally hides missing head and inaccessible factory behind the same 404.
    if (error.status === 404) return "not-found";
    if (error.status === 503) return "unavailable";
    if (error.status === 200 || (error.contractError?.code ?? error.apiError?.code ?? "").includes("INTEGRITY")) return "integrity-error";
    return "error";
  }
  return error instanceof TypeError ? "network-error" : "error";
}

/** Read-only. Counts and preview remain one read_at snapshot; no cache overlay or command retries. */
export function useOperationsOverview({ api, factoryId }: { api: Pick<OperationsApiClient, "getOperationsOverview">; factoryId: string }) {
  const [state, setState] = useState<OperationsOverviewState>({ factoryId, kind: "loading", data: null });
  const active = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const sequence = ++active.current;
    if (!factoryId.trim()) { setState({ factoryId, kind: "missing-factory", data: null }); return; }
    setState({ factoryId, kind: "loading", data: null });
    try {
      const data = await api.getOperationsOverview(factoryId, { signal: abort.signal });
      if (abort.signal.aborted || sequence !== active.current) return;
      validateOverview(data, factoryId);
      setState({ factoryId, kind: "ready", data });
    } catch (error) {
      if (abort.signal.aborted || sequence !== active.current) return;
      const kind = failure(error);
      setState({ factoryId, kind, data: null, message: messages[kind] });
    }
  }, [api, factoryId]);
  const cancel = useCallback(() => { ++active.current; controller.current?.abort(); }, []);
  useEffect(() => {
    void read();
    return cancel;
  }, [read, cancel]);
  const refresh = useCallback(() => { void read(); }, [read]);
  const visible: OperationsOverviewState = state.factoryId === factoryId ? state : { factoryId, kind: "loading", data: null };
  return { state: visible, refresh, retry: refresh };
}
