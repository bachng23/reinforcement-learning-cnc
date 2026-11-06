import type { DecisionCaseStatus, MachineStatus, DecisionCaseStatusResponse } from "@/types/generated/operations";
import type { DecisionCaseListItem } from "./decision-case-reads";
import type { OperationsDecisionCaseProcessing } from "./client";

/** HTTP summary from Backend PR #45 (9404ecb), not a canonical domain model. */
export interface OperationsOverview {
  context: {
    factory_id: string; snapshot_id: string; plan_version: number; head_revision: number;
    captured_at: string; read_at: string;
    publication: { schedule_id: string; schedule_revision: number; basis_snapshot_id: string } | null;
  };
  machines: { total: number; by_status: Record<MachineStatus, number> };
  cases: Record<DecisionCaseStatusResponse["mode"], {
    total: number; by_status: Record<DecisionCaseStatus, number>;
    by_processing: Record<OperationsDecisionCaseProcessing["status"], number>;
  }>;
  review_preview: {
    items: DecisionCaseListItem[]; limit: 6; has_more: boolean;
    filters: { factory_id: string; mode: "LIVE"; status: "AWAITING_APPROVAL" };
  };
  provenance: {
    machines: { source: "validated_current_snapshot"; snapshot_id: string; observed_at: string; population: number; covered: number };
    cases: { source: "decision_cases"; scope: "all_factory_cases_including_stale_and_terminal"; read_at: string };
  };
}

export const machineStatuses = ["IDLE", "RUNNING", "WARNING", "MAINTENANCE", "FAILED", "UNAVAILABLE"] as const satisfies readonly MachineStatus[];
export const caseStatuses = ["CREATED", "ANALYZING", "GENERATING", "VALIDATING", "EXPLAINING", "AWAITING_APPROVAL", "APPROVED", "MODIFIED", "REJECTED", "COMMITTED", "FAILED", "CANCELLED"] as const satisfies readonly DecisionCaseStatus[];
export const processingStatuses = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export function zeroBuckets<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map(key => [key, 0])) as Record<K, number>;
}

export class OverviewIntegrityError extends Error {}
export class OverviewContextMismatchError extends Error {}
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const date = (value: unknown) => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown) => typeof value === "string" && value.length > 0;

/** Fail closed on incomplete summaries, mixed scopes or contradictory aggregates. */
export function validateOverview(value: unknown, factoryId: string): asserts value is OperationsOverview {
  try {
    const data = value as OperationsOverview;
    const { context: c, provenance: p, review_preview: r } = data;
    if (!text(c.factory_id) || !text(c.snapshot_id) || !integer(c.plan_version) || !integer(c.head_revision)
      || !date(c.captured_at) || !date(c.read_at)) throw new Error();
    if (c.factory_id !== factoryId) throw new OverviewContextMismatchError("Overview factory does not match requested scope");
    const buckets = (counts: Record<string, number>, keys: readonly string[], total: number) => integer(total)
      && Object.keys(counts).length === keys.length && keys.every(key => integer(counts[key]))
      && keys.reduce((sum, key) => sum + counts[key], 0) === total;
    if (!buckets(data.machines.by_status, machineStatuses, data.machines.total)) throw new Error();
    for (const mode of ["LIVE", "SIMULATION_ONLY"] as const) {
      const counts = data.cases[mode];
      if (!buckets(counts.by_status, caseStatuses, counts.total) || !buckets(counts.by_processing, processingStatuses, counts.total)) throw new Error();
    }
    if (c.publication !== null && (!text(c.publication.schedule_id) || !text(c.publication.basis_snapshot_id) || !integer(c.publication.schedule_revision))) throw new Error();
    if ((c.plan_version === 0) !== (c.publication === null)) throw new Error();
    if (p.machines.source !== "validated_current_snapshot" || p.machines.snapshot_id !== c.snapshot_id
      || p.machines.observed_at !== c.captured_at || p.machines.covered !== data.machines.total
      || p.machines.population !== data.machines.total || p.cases.source !== "decision_cases"
      || p.cases.scope !== "all_factory_cases_including_stale_and_terminal" || p.cases.read_at !== c.read_at) throw new Error();
    if (r.limit !== 6 || typeof r.has_more !== "boolean" || !Array.isArray(r.items)
      || r.filters.factory_id !== factoryId || r.filters.mode !== "LIVE" || r.filters.status !== "AWAITING_APPROVAL"
      || r.items.length !== Math.min(6, data.cases.LIVE.by_status.AWAITING_APPROVAL)
      || r.has_more !== (data.cases.LIVE.by_status.AWAITING_APPROVAL > 6)
      || new Set(r.items.map(item => item.decision_case_id)).size !== r.items.length) throw new Error();
    for (const item of r.items) {
      if (item.factory_id !== factoryId || item.current_context?.snapshot_id !== c.snapshot_id || item.current_context.plan_version !== c.plan_version) {
        throw new OverviewContextMismatchError("Preview and Overview contexts differ");
      }
      if (item.mode !== "LIVE" || item.status !== "AWAITING_APPROVAL" || item.schema_version !== "3.0"
        || !text(item.decision_case_id) || !text(item.snapshot_id) || !integer(item.base_plan_version)
        || !integer(item.case_revision) || !date(item.created_at) || !date(item.updated_at)
        || typeof item.stale !== "boolean" || item.stale !== (item.snapshot_id !== c.snapshot_id || item.base_plan_version !== c.plan_version)) throw new Error();
    }
  } catch (error) {
    if (error instanceof OverviewContextMismatchError) throw error;
    throw new OverviewIntegrityError("Overview response is incomplete or inconsistent");
  }
}
