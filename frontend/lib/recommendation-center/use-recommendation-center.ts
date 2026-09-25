"use client";

import { useCallback, useEffect, useState } from "react";

import { OperationsApiError } from "@/lib/operations-api/client";
import {
  isRecommendationPollingStatus,
  type RecommendationCenterData,
  type RecommendationCenterDataSource,
} from "@/lib/recommendation-center/data-source";

function shouldPoll(data: RecommendationCenterData): boolean {
  return data.source === "real"
    && data.artifactState === "pending"
    && isRecommendationPollingStatus(data.caseStatus.status);
}

/*
 * The hook owns one request chain at a time. A retry replaces that chain, while
 * terminal, blocked and fail-closed mismatch states never schedule another read.
 */
export type RecommendationCenterState =
  | { kind: "loading" }
  | { kind: "ready"; data: RecommendationCenterData }
  | { kind: "missing-case-id" }
  | { kind: "unauthorized"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "network-error"; message: string }
  | { kind: "error"; message: string };

function apiErrorMessage(error: OperationsApiError): string {
  return error.contractError?.message ?? error.apiError?.message ?? error.message;
}

function failureState(error: unknown): Exclude<RecommendationCenterState, { kind: "loading" } | { kind: "ready" } | { kind: "missing-case-id" }> {
  if (error instanceof Error && error.name === "AuthRedirectError") {
    return {
      kind: "unauthorized",
      message: "Your session has expired. Sign in again to view this decision case.",
    };
  }

  if (error instanceof OperationsApiError) {
    const message = apiErrorMessage(error);
    if (error.status === 401 || error.status === 403) return { kind: "unauthorized", message };
    if (error.status === 404) return { kind: "not-found", message };
    if (error.status === 409) return { kind: "conflict", message };
    if (error.status === 503) return { kind: "unavailable", message };
    return { kind: "error", message };
  }

  return {
    kind: "network-error",
    message: error instanceof Error && error.message
      ? `Network error: ${error.message}`
      : "The Decision Case request did not complete.",
  };
}

export function useRecommendationCenter({
  dataSource,
  caseId,
  pollIntervalMs = 2_000,
}: {
  dataSource: RecommendationCenterDataSource;
  caseId?: string;
  pollIntervalMs?: number;
}) {
  const resolvedCaseId = caseId?.trim() || dataSource.defaultCaseId;
  const [state, setState] = useState<RecommendationCenterState>(
    resolvedCaseId ? { kind: "loading" } : { kind: "missing-case-id" },
  );
  const [requestRevision, setRequestRevision] = useState(0);

  useEffect(() => {
    if (!resolvedCaseId) {
      setState((current) => current.kind === "missing-case-id" ? current : { kind: "missing-case-id" });
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async (showLoading: boolean) => {
      if (showLoading) setState({ kind: "loading" });
      try {
        const data = await dataSource.read(resolvedCaseId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState({ kind: "ready", data });
        if (shouldPoll(data)) {
          timer = setTimeout(() => void read(false), pollIntervalMs);
        }
      } catch (error: unknown) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
        setState(failureState(error));
      }
    };

    void read(true);
    return () => {
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [dataSource, pollIntervalMs, requestRevision, resolvedCaseId]);

  const retry = useCallback(() => {
    setRequestRevision((value) => value + 1);
  }, []);

  const polling = state.kind === "ready" && shouldPoll(state.data);

  return { state, retry, caseId: resolvedCaseId, polling };
}
