"use client";

import { useCallback, useEffect, useState } from "react";

import {
  OperationsApiError,
  type OperationsApiClient,
  type OperationsCurrentScheduleResponse,
  type OperationsSnapshotResponse,
} from "@/lib/operations-api/client";

export type OperationsContextData = {
  snapshotResponse: OperationsSnapshotResponse;
  scheduleResponse: OperationsCurrentScheduleResponse;
};

export type OperationsContextState =
  | { kind: "loading" }
  | { kind: "ready"; data: OperationsContextData }
  | { kind: "unauthorized"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "network-error"; message: string }
  | { kind: "mismatch"; message: string }
  | { kind: "error"; message: string };

function operationsApiErrorMessage(error: OperationsApiError): string {
  return error.contractError?.message ?? error.apiError?.message ?? error.message;
}

function failureState(error: unknown): Exclude<OperationsContextState, { kind: "loading" } | { kind: "ready" }> {
  if (error instanceof Error && error.name === "AuthRedirectError") {
    return {
      kind: "unauthorized",
      message: "Your session has expired. Sign in again to view operations data.",
    };
  }

  if (error instanceof OperationsApiError) {
    const message = operationsApiErrorMessage(error);
    if (error.status === 401 || error.status === 403) {
      return { kind: "unauthorized", message };
    }
    if (error.status === 404) {
      return {
        kind: "unavailable",
        message: message || "No snapshot is available for this factory.",
      };
    }
    if (error.status === 503) {
      return {
        kind: "unavailable",
        message: message || "The operations snapshot service is temporarily unavailable.",
      };
    }
    return { kind: "error", message };
  }

  return {
    kind: "network-error",
    message: error instanceof Error && error.message
      ? `Network error: ${error.message}`
      : "The Operations API request did not complete.",
  };
}

export function useOperationsContext({
  api,
  factoryId,
}: {
  api: OperationsApiClient;
  factoryId: string;
}) {
  const [state, setState] = useState<OperationsContextState>({ kind: "loading" });
  const [requestRevision, setRequestRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    void Promise.all([
      api.getOperationsSnapshot(factoryId, { signal: controller.signal }),
      api.getCurrentSchedule(factoryId, { signal: controller.signal }),
    ]).then(([snapshotResponse, scheduleResponse]) => {
      if (controller.signal.aborted) return;

      if (
        snapshotResponse.snapshot_id !== scheduleResponse.snapshot_id ||
        snapshotResponse.plan_version !== scheduleResponse.plan_version
      ) {
        setState({
          kind: "mismatch",
          message: "Snapshot and schedule changed during this read. Refresh to load one consistent operations context.",
        });
        return;
      }

      setState({
        kind: "ready",
        data: { snapshotResponse, scheduleResponse },
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      setState(failureState(error));
    });

    return () => controller.abort();
  }, [api, factoryId, requestRevision]);

  const retry = useCallback(() => {
    setRequestRevision((value) => value + 1);
  }, []);

  return { state, retry };
}
