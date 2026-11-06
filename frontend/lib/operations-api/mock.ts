import {
  OperationsApiError,
  type OperationsApiClient,
  type OperationsRequestOptions,
  type OperationsSnapshotResponse,
  type OperationsCurrentScheduleResponse,
  type OperationsDecisionCaseReadResponse,
  type OperationsDecisionCaseRecommendationResponse,
  type OperationsWriteOptions,
} from "./client";
import { createOperationsDemoFixtures, createOperationsRecommendationFixture } from "./fixtures";
import type { DecisionCaseHistoryEvent, DecisionCaseListItem } from "./decision-case-reads";
import { caseStatuses, machineStatuses, processingStatuses, zeroBuckets, type OperationsOverview } from "./overview";

function normalizedRequest(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
}

export type OperationsMockMode = "success" | "empty-schedule" | "unauthorized" | "unavailable" | "forbidden" | "missing-snapshot" | "integrity-error";

/** Isolated, explicit preview workflow using the same transport DTOs as HTTP. */
export function createMockOperationsApiClient({
  mode = "success",
  persist = false,
}: { mode?: OperationsMockMode; persist?: boolean } = {}): OperationsApiClient {
  const basis = createOperationsDemoFixtures().request.factory_snapshot;
  if (mode === "empty-schedule") basis.current_schedule = null;
  let published = basis.current_schedule ?? null;
  let planVersion = published ? 1 : 0;
  let commit: OperationsCurrentScheduleResponse["commit"] = null;
  const cases = new Map<string, { response: OperationsDecisionCaseReadResponse; artifact: OperationsDecisionCaseRecommendationResponse }>();
  const receipts = new Map<string, { body: string; response: OperationsDecisionCaseReadResponse }>();
  const events = new Map<string, DecisionCaseHistoryEvent[]>();
  const storageKey = `operations-preview:v1:${mode}`;
  if (persist && typeof sessionStorage !== "undefined") {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as {
        published: typeof published; planVersion: number; commit: typeof commit;
        cases: [string, { response: OperationsDecisionCaseReadResponse; artifact: OperationsDecisionCaseRecommendationResponse }][];
        receipts: [string, { body: string; response: OperationsDecisionCaseReadResponse }][];
        events?: [string, DecisionCaseHistoryEvent[]][];
      } | null;
      if (saved) {
        published = saved.published; planVersion = saved.planVersion; commit = saved.commit;
        for (const [key, value] of saved.cases) cases.set(key, value);
        for (const [key, value] of saved.receipts) receipts.set(key, value);
        for (const [key, value] of saved.events ?? []) events.set(key, value);
      }
    } catch { /* A corrupt/disabled preview store starts a fresh explicit preview. */ }
  }
  function save() {
    if (!persist || typeof sessionStorage === "undefined") return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ published, planVersion, commit, cases: [...cases], receipts: [...receipts], events: [...events] })); }
    catch { /* Preview remains available in memory; real mode never uses this store. */ }
  }
  function fail(status: number, code: string, message: string): never {
    throw new OperationsApiError(status, {
      schema_version: "3.0", error_id: "mock-error", code, message,
      correlation_id: "mock-request", retryable: status === 503, details: [],
    });
  }

  function check(options?: OperationsRequestOptions) {
    options?.signal?.throwIfAborted();
    if (mode === "unauthorized") fail(401, "UNAUTHORIZED", "Authentication or permission is required");
    if (mode === "unavailable") fail(503, "DB_UNAVAILABLE", "Operations context is unavailable");
    if (mode === "forbidden") fail(403, "FORBIDDEN", "Access is forbidden");
    if (mode === "missing-snapshot") fail(404, "OPERATIONS_CONTEXT_NOT_FOUND", "Operations context was not found");
    if (mode === "integrity-error") fail(500, "OPERATIONS_INTEGRITY_ERROR", "Operations context is inconsistent");
  }

  function read(factoryId: string, options?: OperationsRequestOptions) {
    check(options);
    const snapshot = structuredClone(basis);
    if (factoryId !== snapshot.factory_id) fail(404, "FACTORY_NOT_FOUND", "Factory was not found");
    if (mode === "empty-schedule") snapshot.current_schedule = null;
    return snapshot;
  }

  function recordEvent(caseId: string, type: string, payload: DecisionCaseHistoryEvent["payload"], kind: "HUMAN" | "SYSTEM" = "HUMAN") {
    const history = events.get(caseId) ?? [];
    history.push({ id: crypto.randomUUID(), case_id: caseId, sequence: history.length + 1, type,
      actor: { kind, id: "preview-operator" }, occurred_at: new Date().toISOString(), payload });
    events.set(caseId, history);
  }
  function listItem(response: OperationsDecisionCaseReadResponse): DecisionCaseListItem {
    const meta = response.meta!;
    const human = meta.human_decision;
    const publication = meta.commit;
    return { ...structuredClone(response.caseStatus), schema_version: "3.0", factory_id: meta.factory_id,
      recommendation_id: response.caseStatus.recommendation_id ?? null,
      committed_schedule_id: response.caseStatus.committed_schedule_id ?? null, error_code: response.caseStatus.error_code ?? null,
      base_plan_version: meta.base_plan_version, case_revision: meta.case_revision,
      current_context: { snapshot_id: basis.snapshot_id, plan_version: planVersion },
      stale: meta.base_plan_version !== planVersion,
      human_decision: human ? { decision: human.decision, recommendation_id: human.recommendation_id,
        candidate_plan_id: human.candidate_plan_id, candidate_version: human.candidate_version, actor_id: human.actor_id, decided_at: human.decided_at } : null,
      publication: publication ? { schedule_id: publication.schedule_id, schedule_revision: publication.schedule_revision,
        plan_version: publication.plan_version, snapshot_id: publication.snapshot_id, actor_id: publication.actor_id, committed_at: publication.committed_at } : null };
  }

  return {
    async getOperationsOverview(factoryId, options): Promise<OperationsOverview> {
      const snapshot = read(factoryId, options);
      const readAt = new Date().toISOString();
      const machines = { total: snapshot.machines.length, by_status: zeroBuckets(machineStatuses) };
      for (const machine of snapshot.machines) ++machines.by_status[machine.status];
      const emptyCounts = () => ({ total: 0, by_status: zeroBuckets(caseStatuses), by_processing: zeroBuckets(processingStatuses) });
      const counts = { LIVE: emptyCounts(), SIMULATION_ONLY: emptyCounts() };
      for (const { response } of cases.values()) {
        const group = counts[response.caseStatus.mode];
        ++group.total;
        ++group.by_status[response.caseStatus.status];
        ++group.by_processing[response.meta?.processing?.status ?? "SUCCEEDED"];
      }
      const preview = [...cases.values()].map(item => listItem(item.response))
        .filter(item => item.mode === "LIVE" && item.status === "AWAITING_APPROVAL")
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.decision_case_id.localeCompare(a.decision_case_id));
      return {
        context: { factory_id: factoryId, snapshot_id: snapshot.snapshot_id, plan_version: planVersion,
          head_revision: planVersion, captured_at: snapshot.captured_at, read_at: readAt,
          publication: published ? { schedule_id: published.schedule_id, schedule_revision: published.revision, basis_snapshot_id: basis.snapshot_id } : null },
        machines, cases: counts,
        review_preview: { items: preview.slice(0, 6), limit: 6, has_more: preview.length > 6,
          filters: { factory_id: factoryId, mode: "LIVE", status: "AWAITING_APPROVAL" } },
        provenance: {
          machines: { source: "validated_current_snapshot", snapshot_id: snapshot.snapshot_id, observed_at: snapshot.captured_at,
            population: machines.total, covered: machines.total },
          cases: { source: "decision_cases", scope: "all_factory_cases_including_stale_and_terminal", read_at: readAt },
        },
      };
    },
    async listDecisionCases(query, options) {
      read(query.factory_id, options);
      const limit = query.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, "VALIDATION_ERROR", "Invalid page limit");
      const scope = JSON.stringify([query.factory_id, query.status ?? null, query.mode ?? null]);
      type PreviewCursor = { scope: string; created: string; id: string };
      let after: PreviewCursor | null = null;
      if (query.cursor !== undefined) {
        try {
          after = JSON.parse(decodeURIComponent(query.cursor)) as PreviewCursor;
          if (!after || after.scope !== scope || typeof after.created !== "string" || typeof after.id !== "string") throw new Error("Invalid preview cursor");
        } catch { fail(400, "INVALID_CURSOR", "Cursor does not match preview filters"); }
      }
      const filtered = [...cases.values()].map(item => listItem(item.response)).filter(item =>
        item.factory_id === query.factory_id && (!query.status || item.status === query.status) && (!query.mode || item.mode === query.mode))
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.decision_case_id.localeCompare(left.decision_case_id))
        .filter(item => !after || item.created_at < after.created || (item.created_at === after.created && item.decision_case_id < after.id));
      const data = filtered.slice(0, limit);
      const has_more = filtered.length > limit;
      const last = data.at(-1);
      return { success: true, data, meta: { factory_id: query.factory_id, limit, has_more,
        next_cursor: has_more && last ? encodeURIComponent(JSON.stringify({ scope, created: last.created_at, id: last.decision_case_id })) : null } };
    },
    async getOperationsSnapshot(factoryId, options): Promise<OperationsSnapshotResponse> {
      const snapshot = read(factoryId, options);
      return {
        factory_id: snapshot.factory_id,
        snapshot_id: snapshot.snapshot_id,
        schema_version: "3.0",
        captured_at: snapshot.captured_at,
        plan_version: planVersion,
        current_schedule_id: published?.schedule_id ?? null,
        snapshot,
      };
    },
    async getCurrentSchedule(factoryId, options): Promise<OperationsCurrentScheduleResponse> {
      const snapshot = read(factoryId, options);
      return {
        factory_id: snapshot.factory_id,
        snapshot_id: snapshot.snapshot_id,
        plan_version: planVersion,
        schedule: structuredClone(published),
        basis_snapshot: published ? snapshot : null,
        commit: structuredClone(commit),
      };
    },
    async getDecisionCase(caseId, options) {
      check(options);
      const item = cases.get(caseId);
      if (!item) fail(404, "DECISION_CASE_NOT_FOUND", "Preview case not found");
      const response = structuredClone(item.response);
      if (response.caseStatus.status === "CREATED") {
        item.response.caseStatus.status = "AWAITING_APPROVAL";
        item.response.caseStatus.recommendation_id = item.artifact.recommendation.recommendation_id;
        item.response.meta!.case_revision += 1;
        item.response.meta!.processing = { status: "SUCCEEDED", attempt: 1, error_code: null };
        recordEvent(caseId, "CASE_STATUS_CHANGED", { from_status: "CREATED", to_status: "AWAITING_APPROVAL", revision: item.response.meta!.case_revision }, "SYSTEM");
        save();
      }
      response.meta!.current_context = { snapshot_id: basis.snapshot_id, plan_version: planVersion };
      response.meta!.stale = response.meta!.base_plan_version !== planVersion;
      response.meta!.available_commands = response.meta!.stale ? []
        : response.caseStatus.status === "AWAITING_APPROVAL" ? ["APPROVE", "REJECT"]
          : response.caseStatus.status === "APPROVED" && response.caseStatus.mode === "LIVE" ? ["COMMIT"] : [];
      return response;
    },
    async getDecisionCaseRecommendation(caseId, options) {
      check(options);
      const item = cases.get(caseId);
      if (!item) fail(404, "DECISION_CASE_NOT_FOUND", "Preview case not found");
      if (!item.response.caseStatus.recommendation_id) fail(404, "RECOMMENDATION_NOT_READY", "Recommendation is not ready");
      return structuredClone(item.artifact);
    },
    async createDecisionCase(body, options) {
      read(body.factory_id, options);
      const replay = receipt(options, body);
      if (replay) return replay;
      if (body.expected_snapshot_id !== basis.snapshot_id || body.expected_plan_version !== planVersion) fail(409, "SNAPSHOT_CONFLICT", "Preview basis is stale");
      const caseId = crypto.randomUUID();
      const now = new Date().toISOString();
      const response: OperationsDecisionCaseReadResponse = {
        caseStatus: { schema_version: "3.0", decision_case_id: caseId, mode: body.request.mode,
          status: "CREATED", snapshot_id: basis.snapshot_id, created_at: now, updated_at: now,
          recommendation_id: null, committed_schedule_id: null, error_code: null },
        meta: { factory_id: basis.factory_id, base_plan_version: planVersion, case_revision: 1,
          current_context: { snapshot_id: basis.snapshot_id, plan_version: planVersion }, stale: false,
          processing: { status: "PENDING", attempt: 0, error_code: null },
          available_commands: [], approved_candidate: null, human_decision: null, commit: null },
      };
      cases.set(caseId, { response, artifact: { recommendation: createOperationsRecommendationFixture(caseId), snapshot: structuredClone(basis) } });
      recordEvent(caseId, "CASE_CREATED", { status: "CREATED", revision: 1 });
      receipts.set(options.idempotencyKey, { body: normalizedRequest(body), response: structuredClone(response) });
      save();
      return structuredClone(response);
    },
    async submitDecisionCommand(caseId, body, options) {
      check(options);
      const replay = receipt(options, body);
      if (replay) return replay;
      const item = cases.get(caseId);
      if (!item) fail(404, "DECISION_CASE_NOT_FOUND", "Preview case not found");
      const response = item.response;
      const fromStatus = response.caseStatus.status;
      const meta = response.meta!;
      if (body.decision_case_id !== caseId || body.expected_snapshot_id !== basis.snapshot_id
        || body.expected_plan_version !== planVersion || meta.base_plan_version !== planVersion
        || body.expected_case_revision !== meta.case_revision
        || body.recommendation_id !== item.artifact.recommendation.recommendation_id) fail(409, "CASE_REVISION_CONFLICT", "Review current preview context");
      if (response.caseStatus.status !== (body.command === "COMMIT" ? "APPROVED" : "AWAITING_APPROVAL")) fail(409, "CASE_STATE_CONFLICT", "Command unavailable");
      const now = new Date().toISOString();
      if (body.command === "REJECT") {
        if (!body.note.trim() || body.note.length > 4000) fail(400, "VALIDATION_ERROR", "Rejection note is required");
        meta.human_decision = { decision: "REJECT", recommendation_id: body.recommendation_id,
          candidate_plan_id: null, candidate_version: null, candidate_hash: null, schedule_hash: null,
          note: body.note, actor_id: "preview-operator", decided_at: now };
        response.caseStatus.status = "REJECTED";
      } else {
        const candidate = item.artifact.recommendation.candidate_plans.find(p => p.candidate_plan_id === body.candidate_plan_id);
        if (!candidate || candidate.plan_version !== body.candidate_version || candidate.validation?.verdict !== "VALID") fail(409, "CANDIDATE_NOT_VALID", "Candidate must be valid");
        if (body.command === "APPROVE") {
          meta.approved_candidate = { recommendation_id: body.recommendation_id, candidate_plan_id: body.candidate_plan_id,
            candidate_version: body.candidate_version, candidate_hash: "a".repeat(64), schedule_hash: "b".repeat(64) };
          meta.human_decision = { ...meta.approved_candidate, decision: "APPROVE", note: body.note ?? null, actor_id: "preview-operator", decided_at: now };
          response.caseStatus.status = "APPROVED";
        } else {
          if (response.caseStatus.mode !== "LIVE" || meta.approved_candidate?.candidate_plan_id !== body.candidate_plan_id
            || meta.approved_candidate.candidate_version !== body.candidate_version) fail(409, "APPROVED_CANDIDATE_CONFLICT", "Commit only the approved candidate");
          published = structuredClone(candidate.schedule);
          planVersion += 1;
          commit = { decision_case_id: caseId, factory_id: basis.factory_id, snapshot_id: basis.snapshot_id,
            schedule_id: published.schedule_id, schedule_revision: published.revision, schedule_hash: meta.approved_candidate.schedule_hash,
            plan_version: planVersion, actor_id: "preview-operator", committed_at: now };
          meta.commit = commit;
          response.caseStatus.status = "COMMITTED";
          response.caseStatus.committed_schedule_id = published.schedule_id;
          meta.stale = true;
        }
      }
      meta.case_revision += 1;
      meta.current_context = { snapshot_id: basis.snapshot_id, plan_version: planVersion };
      meta.available_commands = response.caseStatus.status === "APPROVED" && response.caseStatus.mode === "LIVE" ? ["COMMIT"] : [];
      response.caseStatus.updated_at = now;
      recordEvent(caseId, "CASE_STATUS_CHANGED", { from_status: fromStatus, to_status: response.caseStatus.status,
        revision: meta.case_revision, command: body.command, recommendation_id: body.recommendation_id,
        candidate_plan_id: body.command === "REJECT" ? null : body.candidate_plan_id,
        candidate_version: body.command === "REJECT" ? null : body.candidate_version,
        candidate_hash: body.command === "REJECT" ? null : meta.approved_candidate?.candidate_hash,
        schedule_hash: body.command === "REJECT" ? null : meta.approved_candidate?.schedule_hash, plan_version: planVersion });
      receipts.set(options.idempotencyKey, { body: normalizedRequest(body), response: structuredClone(response) });
      save();
      return structuredClone(response);
    },
    async listEvents(caseId, afterSequence = 0, options) {
      check(options);
      if (!cases.has(caseId)) fail(404, "DECISION_CASE_NOT_FOUND", "Preview case not found");
      const limit = options?.limit ?? 100;
      if (!Number.isInteger(afterSequence) || afterSequence < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) fail(400, "VALIDATION_ERROR", "Invalid history pagination");
      const rows = (events.get(caseId) ?? []).filter(event => event.sequence > afterSequence);
      const data = structuredClone(rows.slice(0, limit));
      return { success: true, data, meta: { has_more: rows.length > limit, next_after_sequence: data.at(-1)?.sequence ?? afterSequence } };
    },
    eventsUrl: () => fail(501, "NOT_IMPLEMENTED", "The operations mock does not provide an event stream"),
  };

  function receipt(options: OperationsWriteOptions, body: unknown) {
    if (!options.idempotencyKey || !/^[\x21-\x7e]{1,128}$/.test(options.idempotencyKey)) fail(400, "VALIDATION_ERROR", "Idempotency-Key is required");
    const stored = receipts.get(options.idempotencyKey);
    if (stored && stored.body !== normalizedRequest(body)) fail(409, "IDEMPOTENCY_KEY_REUSED", "Key already belongs to another request");
    return stored ? structuredClone(stored.response) : null;
  }
}
