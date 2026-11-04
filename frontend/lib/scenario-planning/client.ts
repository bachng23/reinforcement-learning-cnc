import { authFetch, endpoint, type TokenUser } from "@/lib/auth";
import schema from "@/types/generated/scenario-planning.schema.json";
import capabilities from "@/types/generated/scenario-planning.manifest.json";
import type * as DTO from "@/types/generated/scenario-planning";
import {
  createOperationsApiClient,
  type OperationsApiClient,
} from "@/lib/operations-api/client";

export function sameScenarioHead(left: DTO.Head, right: DTO.Head) {
  return (
    left.snapshot_id === right.snapshot_id &&
    left.plan_version === right.plan_version &&
    left.revision === right.revision
  );
}
export function assertScenarioContext(
  job: DTO.Job,
  workspace: DTO.Workspace,
  source?: DTO.Job,
) {
  if (!matchesScenarioSchema(job, "Job"))
    throw new ScenarioError(502, "INVALID_RESPONSE");
  if (
    job.workspace_id !== workspace.workspace_id ||
    job.engine_version !== workspace.engine_version ||
    job.contract_version !== workspace.contract_version
  )
    throw new ScenarioError(502, "CONTEXT_MISMATCH");
  const result = job.result;
  if (!result) return;
  if (
    result.identity.factory_id !== workspace.baseline.factory_id ||
    result.identity.workspace_id !== workspace.workspace_id ||
    result.engine_version !== job.engine_version ||
    result.contract_version !== job.contract_version
  )
    throw new ScenarioError(502, "CONTEXT_MISMATCH");
  const validateEvaluation = (value: DTO.Evaluation) => {
    const candidates = value.candidates ?? [];
    const ids = candidates.map((candidate) => candidate.candidate_plan_id);
    if (
      new Set(ids).size !== ids.length ||
      (value.outcome === "FEASIBLE"
        ? !ids.length ||
          !value.selected_candidate_id ||
          !ids.includes(value.selected_candidate_id) ||
          !value.ranking ||
          value.ranking.rows.length !== ids.length ||
          value.ranking.rows[0]?.candidate_plan_id !==
            value.selected_candidate_id ||
          new Set(value.ranking.rows.map((row) => row.candidate_plan_id))
            .size !== ids.length ||
          value.ranking.rows.some((row) => !ids.includes(row.candidate_plan_id))
        : ids.length > 0 ||
          value.selected_candidate_id != null ||
          value.ranking != null) ||
      candidates.some(
        (candidate) =>
          candidate.validation?.verdict !== "VALID" ||
          candidate.validation.candidate_plan_id !==
            candidate.candidate_plan_id ||
          candidate.schedule.factory_id !== workspace.baseline.factory_id ||
          candidate.snapshot_id !== workspace.baseline.snapshot_id,
      )
    )
      throw new ScenarioError(502, "INVALID_RESPONSE");
  };
  if (job.kind === "RUN") {
    if (
      !("scenario" in result) ||
      result.identity.run_id !== job.job_id ||
      result.identity.frozen_input_hash !== job.input_hash ||
      result.effective.source_hash !== workspace.baseline.snapshot_hash ||
      (result.effective.snapshot &&
        (result.effective.snapshot.snapshot_id !==
          workspace.baseline.snapshot_id ||
          result.effective.snapshot.factory_id !==
            workspace.baseline.factory_id))
    )
      throw new ScenarioError(502, "CONTEXT_MISMATCH");
    validateEvaluation(result.baseline);
    validateEvaluation(result.scenario);
  } else {
    if (
      !("points" in result) ||
      result.identity.run_id !== job.source_run_id ||
      (source &&
        (source.job_id !== job.source_run_id ||
          source.input_hash !== result.identity.frozen_input_hash))
    )
      throw new ScenarioError(502, "CONTEXT_MISMATCH");
    if (
      result.points.length !== result.axis.values.length ||
      new Set(result.points.map((point) => point.value)).size !==
        result.points.length ||
      result.points.some(
        (point) =>
          !result.axis.values.includes(point.value) ||
          point.status !== point.evaluation.outcome,
      )
    )
      throw new ScenarioError(502, "INVALID_RESPONSE");
    validateEvaluation(result.baseline_point);
    result.points.forEach((point) => validateEvaluation(point.evaluation));
  }
}

type JsonSchema = {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  allOf?: JsonSchema[];
  pattern?: string;
  format?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};
const definitions = schema.definitions as unknown as Record<string, JsonSchema>;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function matchesScenarioSchema(
  value: unknown,
  definition: string | JsonSchema,
): boolean {
  const s =
    typeof definition === "string" ? definitions[definition] : definition;
  if (!s) return false;
  if (s.allOf && !s.allOf.every((item) => matchesScenarioSchema(value, item)))
    return false;
  if (s.$ref) return matchesScenarioSchema(value, s.$ref.split("/").at(-1)!);
  if (s.anyOf && !s.anyOf.some((item) => matchesScenarioSchema(value, item)))
    return false;
  if (
    s.oneOf &&
    s.oneOf.filter((item) => matchesScenarioSchema(value, item)).length !== 1
  )
    return false;
  if ("const" in s && value !== s.const) return false;
  if (s.enum && !s.enum.includes(value)) return false;
  const types = typeof s.type === "string" ? [s.type] : s.type;
  const type =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : Number.isInteger(value)
          ? "integer"
          : typeof value;
  if (
    types &&
    !types.includes(type) &&
    !(type === "integer" && types.includes("number"))
  )
    return false;
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (s.minimum !== undefined && value < s.minimum) ||
      (s.maximum !== undefined && value > s.maximum))
  )
    return false;
  if (
    typeof value === "number" &&
    ((s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) ||
      (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum))
  )
    return false;
  if (typeof value === "string") {
    if (
      (s.minLength !== undefined && value.length < s.minLength) ||
      (s.maxLength !== undefined && value.length > s.maxLength) ||
      (s.pattern && !new RegExp(s.pattern).test(value))
    )
      return false;
    if (
      s.format === "uuid" &&
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
    )
      return false;
    if (
      (s.format === "date-time" || s.format === "date-time-offset") &&
      (!/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value)))
    )
      return false;
  }
  if (
    Array.isArray(value) &&
    ((s.minItems !== undefined && value.length < s.minItems) ||
      (s.maxItems !== undefined && value.length > s.maxItems) ||
      (s.uniqueItems &&
        new Set(value.map((item) => JSON.stringify(item))).size !==
          value.length) ||
      (s.items && value.some((item) => !matchesScenarioSchema(item, s.items!))))
  )
    return false;
  if (record(value)) {
    if (s.required?.some((key) => !(key in value))) return false;
    if (
      Object.entries(value).some(([key, item]) =>
        s.properties?.[key]
          ? !matchesScenarioSchema(item, s.properties[key])
          : s.additionalProperties === false ||
            (typeof s.additionalProperties === "object" &&
              !matchesScenarioSchema(item, s.additionalProperties)),
      )
    )
      return false;
  }
  return true;
}

export class ScenarioError extends Error {
  constructor(
    public status: number,
    public code: string,
    public requestId?: string,
  ) {
    super(code);
    this.name = "ScenarioError";
  }
}
export function scenarioError(error: unknown) {
  if (error instanceof ScenarioError) return error;
  if (error instanceof Error && error.name === "AuthRedirectError")
    return new ScenarioError(401, "UNAUTHORIZED");
  return new ScenarioError(0, "NETWORK_ERROR");
}
export function scenarioErrorText(error: ScenarioError) {
  if (error.status === 401) return "Sign in again to access Scenario Planning.";
  if (error.status === 403)
    return "Your current role cannot perform this action. Refresh access.";
  if (error.status === 404)
    return "Scenario service or resource is unavailable in your authorized factory. No replacement data is shown.";
  const messages: Record<string, string> = {
    BASELINE_ENTITIES_UNAVAILABLE:
      "The immutable baseline entities are not available from the current read APIs. Historical analysis stays pinned; the editor will not use a newer snapshot.",
    CONTEXT_MISMATCH:
      "The factory or snapshot identities changed during the read. Refresh to review one verified context.",
    INVALID_RESPONSE:
      "The response does not match the pinned producer contract or requested identities. Data is hidden.",
    SESSION_CHANGED:
      "The signed-in user changed. Previous data and drafts are hidden; reload access.",
    SCENARIO_REVISION_CONFLICT:
      "This draft changed. Refresh and explicitly review before saving a new intent. The previous body/revision will not be updated automatically.",
    SCENARIO_HEAD_CONFLICT:
      "Current context changed or this workspace is historical. Review baseline and head; nothing is silently rebased.",
    SCENARIO_LIVE_MAPPING_UNSUPPORTED:
      "These assumptions cannot safely map to the current LIVE contract. A reviewed extension or authorized ingestion is required.",
    DEPENDENCY_PENDING:
      "The reviewed engine/result contract and callable integration are not available. This operation is disabled; no request was submitted.",
    INVALID_CURSOR:
      "The cursor does not match your current user/factory scope. Restart from the first page.",
    INVALID_INPUT:
      "Review the required fields, allowed targets, bounds and planning window. A sweep may not create more than five effective overrides.",
    DUPLICATE_OVERRIDE:
      "Each type/target pair may appear only once. Review the duplicate assumption.",
    INVALID_WINDOW:
      "Keep the horizon and times inside the pinned planning window. Unavailable intervals must be nonempty; deferred start must be before the window ends.",
    INVALID_TARGET: "Choose a target from the pinned baseline entities.",
    INVALID_WEIGHTS:
      "Weights must be finite, between 0 and 1000000, with a positive sum above the canonical tolerance.",
  };
  if (messages[error.code]) return messages[error.code];
  if (error.status === 409)
    return "The request conflicts with authoritative state. Refresh and review; no automatic resubmission occurs.";
  if (error.status >= 500)
    return "Scenario service is unavailable. An unconfirmed write may already exist; recover using the original key and body.";
  if (!error.status)
    return "Network error. An unconfirmed write may have committed. Retry the original intent or reconcile saved records.";
  return "The request was rejected. Review the input and saved state before a new intent.";
}
export type ReadOptions = { signal?: AbortSignal };
export type WriteOptions = ReadOptions & { key: string };
export type PageQuery = { cursor?: string; limit?: number };
export const scenarioCapabilities = capabilities;

export function createScenarioClient({
  fetcher = authFetch,
  baseUrl = endpoint("/api/v1"),
  operations = createOperationsApiClient(),
}: {
  fetcher?: typeof fetch;
  baseUrl?: string;
  operations?: OperationsApiClient;
} = {}) {
  const root = baseUrl.replace(/\/+$/, "");
  const id = encodeURIComponent;
  const path = (workspace: string) => `/scenario-workspaces/${id(workspace)}`;
  const query = (params: Record<string, string | number | undefined>) =>
    new URLSearchParams(
      Object.entries(params)
        .filter(
          (entry): entry is [string, string | number] => entry[1] !== undefined,
        )
        .map(([key, value]) => [key, String(value)]),
    ).toString();
  async function request<T>(
    url: string,
    definition: string,
    options: ReadOptions = {},
    write?: {
      method: "POST" | "PATCH";
      body: unknown;
      schema: string;
      key: string;
    },
  ): Promise<T> {
    if (
      write &&
      (!/^[\x21-\x7e]{1,128}$/.test(write.key) ||
        !matchesScenarioSchema(write.body, write.schema))
    )
      throw new ScenarioError(400, "INVALID_INPUT");
    const response = await fetcher(root + url, {
      method: write?.method ?? "GET",
      cache: "no-store",
      credentials: "include",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(write
          ? { "Content-Type": "application/json", "Idempotency-Key": write.key }
          : {}),
      },
      ...(write ? { body: JSON.stringify(write.body) } : {}),
    });
    const payload: unknown = await response.json().catch(() => null);
    const requestId =
      response.headers.get("X-Request-Id") ??
      (record(payload) && typeof payload.requestId === "string"
        ? payload.requestId
        : undefined);
    if (!response.ok)
      throw new ScenarioError(
        response.status,
        record(payload) &&
          record(payload.error) &&
          typeof payload.error.code === "string"
          ? payload.error.code
          : "REQUEST_FAILED",
        requestId,
      );
    if (!matchesScenarioSchema(payload, definition))
      throw new ScenarioError(502, "INVALID_RESPONSE", requestId);
    return payload as T;
  }
  function assertWorkspace(
    workspace: DTO.Workspace,
    factoryId: string,
    workspaceId?: string,
  ) {
    if (
      workspace.baseline.factory_id !== factoryId ||
      (workspaceId && workspace.workspace_id !== workspaceId)
    )
      throw new ScenarioError(502, "CONTEXT_MISMATCH");
  }
  function assertJob(job: DTO.Job, workspace: string, jobId?: string) {
    if (
      job.workspace_id !== workspace ||
      (jobId && job.job_id !== jobId) ||
      new Set(job.points.map((point) => point.point_index)).size !==
        job.points.length
    )
      throw new ScenarioError(502, "INVALID_RESPONSE");
    if (job.result) {
      const result = job.result;
      if (
        result.identity.workspace_id !== workspace ||
        result.identity.run_id !==
          (job.kind === "RUN" ? job.job_id : job.source_run_id) ||
        result.engine_version !== job.engine_version ||
        result.contract_version !== job.contract_version ||
        (job.kind === "RUN"
          ? !("scenario" in result) ||
            result.identity.frozen_input_hash !== job.input_hash
          : !("points" in result))
      )
        throw new ScenarioError(502, "CONTEXT_MISMATCH");
    }
  }
  return {
    async identity(options: ReadOptions = {}): Promise<TokenUser> {
      const response = await fetcher(root + "/auth/me", {
        credentials: "include",
        cache: "no-store",
        signal: options.signal,
      });
      if (!response.ok)
        throw new ScenarioError(response.status, "SESSION_UNAVAILABLE");
      const payload: unknown = await response.json();
      if (
        !record(payload) ||
        !record(payload.user) ||
        typeof payload.user.id !== "string" ||
        typeof payload.user.role !== "string"
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return {
        id: payload.user.id,
        role: payload.user.role,
        ...(typeof payload.user.username === "string"
          ? { username: payload.user.username }
          : {}),
      };
    },
    async listWorkspaces(
      factoryId: string,
      page: PageQuery = {},
      options?: ReadOptions,
    ) {
      const result = await request<DTO.GetScenarioWorkspaces>(
        `/scenario-workspaces?${query({ factory_id: factoryId, ...page })}`,
        "get_scenario_workspaces",
        options,
      );
      result.data.items.forEach((item) => assertWorkspace(item, factoryId));
      if (
        new Set(result.data.items.map((item) => item.workspace_id)).size !==
          result.data.items.length ||
        (result.data.next_cursor && !result.data.items.length)
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async workspace(
      workspace: string,
      factoryId: string,
      options?: ReadOptions,
    ) {
      const result = await request<DTO.GetScenarioWorkspacesByWorkspaceId>(
        path(workspace),
        "get_scenario_workspaces_by_workspace_id",
        options,
      );
      assertWorkspace(result.data, factoryId, workspace);
      return result.data;
    },
    async createWorkspace(body: DTO.CreateWorkspace, options: WriteOptions) {
      const result = await request<DTO.PostScenarioWorkspaces>(
        "/scenario-workspaces",
        "post_scenario_workspaces",
        options,
        { method: "POST", body, key: options.key, schema: "CreateWorkspace" },
      );
      assertWorkspace(result.data, body.factory_id);
      if (
        result.data.baseline.snapshot_id !== body.expected_head.snapshot_id ||
        result.data.baseline.plan_version !== body.expected_head.plan_version
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async listDrafts(
      workspace: string,
      page: PageQuery = {},
      options?: ReadOptions,
    ) {
      const result =
        await request<DTO.GetScenarioWorkspacesByWorkspaceIdScenarios>(
          `${path(workspace)}/scenarios?${query(page)}`,
          "get_scenario_workspaces_by_workspace_id_scenarios",
          options,
        );
      if (
        result.data.items.some((item) => item.workspace_id !== workspace) ||
        new Set(result.data.items.map((item) => item.scenario_id)).size !==
          result.data.items.length ||
        (result.data.next_cursor && !result.data.items.length)
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async draft(workspace: string, scenario: string, options?: ReadOptions) {
      const result =
        await request<DTO.GetScenarioWorkspacesByWorkspaceIdScenariosByScenarioId>(
          `${path(workspace)}/scenarios/${id(scenario)}`,
          "get_scenario_workspaces_by_workspace_id_scenarios_by_scenario_id",
          options,
        );
      if (
        result.data.workspace_id !== workspace ||
        result.data.scenario_id !== scenario
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async saveDraft(
      workspace: string,
      body: DTO.CreateDraft | DTO.UpdateDraft,
      options: WriteOptions,
      scenario?: string,
    ) {
      const result =
        await request<DTO.PostScenarioWorkspacesByWorkspaceIdScenarios>(
          `${path(workspace)}/scenarios${scenario ? `/${id(scenario)}` : ""}`,
          scenario
            ? "patch_scenario_workspaces_by_workspace_id_scenarios_by_scenario_id"
            : "post_scenario_workspaces_by_workspace_id_scenarios",
          options,
          {
            method: scenario ? "PATCH" : "POST",
            body,
            key: options.key,
            schema: scenario ? "UpdateDraft" : "CreateDraft",
          },
        );
      if (
        result.data.workspace_id !== workspace ||
        (scenario && result.data.scenario_id !== scenario)
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async listRuns(
      workspace: string,
      page: PageQuery = {},
      options?: ReadOptions,
    ) {
      const result = await request<DTO.GetScenarioWorkspacesByWorkspaceIdRuns>(
        `${path(workspace)}/runs?${query(page)}`,
        "get_scenario_workspaces_by_workspace_id_runs",
        options,
      );
      result.data.items.forEach((item) => assertJob(item, workspace));
      if (
        new Set(result.data.items.map((item) => item.job_id)).size !==
          result.data.items.length ||
        (result.data.next_cursor && !result.data.items.length)
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async run(workspace: string, run: string, options?: ReadOptions) {
      const result =
        await request<DTO.GetScenarioWorkspacesByWorkspaceIdRunsByRunId>(
          `${path(workspace)}/runs/${id(run)}`,
          "get_scenario_workspaces_by_workspace_id_runs_by_run_id",
          options,
        );
      assertJob(result.data, workspace, run);
      return result.data;
    },
    async currentContext(factoryId: string, options?: ReadOptions) {
      const [overview, response] = await Promise.all([
        operations.getOperationsOverview(factoryId, options),
        operations.getOperationsSnapshot(factoryId, options),
      ]);
      const context = overview.context;
      if (
        context.factory_id !== factoryId ||
        response.factory_id !== factoryId ||
        response.snapshot.factory_id !== factoryId ||
        context.snapshot_id !== response.snapshot_id ||
        response.snapshot.snapshot_id !== context.snapshot_id ||
        response.plan_version !== context.plan_version
      )
        throw new ScenarioError(409, "CONTEXT_MISMATCH");
      return {
        snapshot: response.snapshot,
        head: {
          snapshot_id: context.snapshot_id,
          plan_version: context.plan_version,
          revision: context.head_revision,
        } satisfies DTO.Head,
        publication: context.publication,
      };
    },
    async baselineEntities(
      workspace: DTO.Workspace,
      options?: ReadOptions,
    ): Promise<DTO.BaselineEntities> {
      const response =
        await request<DTO.GetScenarioWorkspacesByWorkspaceIdBaselineEntities>(
          `${path(workspace.workspace_id)}/baseline-entities`,
          "get_scenario_workspaces_by_workspace_id_baseline_entities",
          options,
        );
      const entities = response.data;
      const basis = entities.baseline;
      const expected = workspace.baseline;
      if (
        entities.workspace_id !== workspace.workspace_id ||
        basis.factory_id !== expected.factory_id ||
        basis.snapshot_id !== expected.snapshot_id ||
        basis.snapshot_hash !== expected.snapshot_hash ||
        basis.plan_version !== expected.plan_version ||
        (basis.publication === null
          ? expected.publication !== null
          : !expected.publication ||
            basis.publication.schedule_id !==
              expected.publication.schedule_id ||
            basis.publication.schedule_revision !==
              expected.publication.schedule_revision ||
            basis.publication.schedule_hash !==
              expected.publication.schedule_hash) ||
        new Set(entities.technicians.map((item) => item.technician_id)).size !==
          entities.technicians.length ||
        new Set(
          entities.maintenance_requests.map(
            (item) => item.maintenance_request_id,
          ),
        ).size !== entities.maintenance_requests.length
      )
        throw new ScenarioError(502, "CONTEXT_MISMATCH");
      return entities;
    },
    async enqueueRun(
      workspace: string,
      body: DTO.EnqueueRun,
      options: WriteOptions,
    ): Promise<DTO.Job> {
      const result = await request<DTO.PostScenarioWorkspacesByWorkspaceIdRuns>(
        `${path(workspace)}/runs`,
        "post_scenario_workspaces_by_workspace_id_runs",
        options,
        { method: "POST", body, key: options.key, schema: "EnqueueRun" },
      );
      assertJob(result.data, workspace);
      if (
        result.data.kind !== "RUN" ||
        result.data.source_scenario_id !==
          (body.kind === "SCENARIO" ? body.scenario_id : null) ||
        result.data.source_revision !==
          (body.kind === "SCENARIO" ? body.expected_revision : null)
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async compare(
      workspace: string,
      ids: string[],
      options?: ReadOptions,
    ): Promise<DTO.CompareResult> {
      if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length)
        throw new ScenarioError(400, "INVALID_INPUT");
      const result =
        await request<DTO.GetScenarioWorkspacesByWorkspaceIdCompare>(
          `${path(workspace)}/compare?${query({ run_ids: ids.map(id).join(",") })}`,
          "get_scenario_workspaces_by_workspace_id_compare",
          options,
        );
      if (
        result.data.reference_identity.workspace_id !== workspace ||
        result.data.reference_identity.run_id !== ids[0] ||
        result.data.runs.length !== ids.length - 1 ||
        result.data.runs.some(
          (run, index) =>
            run.identity.workspace_id !== workspace ||
            run.identity.run_id !== ids[index + 1] ||
            run.identity.factory_id !==
              result.data.reference_identity.factory_id,
        )
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async enqueueSensitivity(
      workspace: string,
      body: DTO.EnqueueSensitivity,
      options: WriteOptions,
    ): Promise<DTO.Job> {
      const result =
        await request<DTO.PostScenarioWorkspacesByWorkspaceIdSensitivityJobs>(
          `${path(workspace)}/sensitivity-jobs`,
          "post_scenario_workspaces_by_workspace_id_sensitivity_jobs",
          options,
          {
            method: "POST",
            body,
            key: options.key,
            schema: "EnqueueSensitivity",
          },
        );
      assertJob(result.data, workspace);
      if (
        result.data.kind !== "SENSITIVITY" ||
        result.data.source_run_id !== body.source_run_id
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async sensitivity(
      workspace: string,
      job: string,
      options?: ReadOptions,
    ): Promise<DTO.Job> {
      const result =
        await request<DTO.GetScenarioWorkspacesByWorkspaceIdSensitivityJobsByJobId>(
          `${path(workspace)}/sensitivity-jobs/${id(job)}`,
          "get_scenario_workspaces_by_workspace_id_sensitivity_jobs_by_job_id",
          options,
        );
      assertJob(result.data, workspace, job);
      if (result.data.kind !== "SENSITIVITY")
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async evaluateLive(
      workspace: string,
      body: DTO.LiveEvaluation,
      options: WriteOptions,
    ): Promise<DTO.LiveCreated> {
      const result =
        await request<DTO.PostScenarioWorkspacesByWorkspaceIdLiveEvaluations>(
          `${path(workspace)}/live-evaluations`,
          "post_scenario_workspaces_by_workspace_id_live_evaluations",
          options,
          { method: "POST", body, key: options.key, schema: "LiveEvaluation" },
        );
      if (
        result.data.workspace_id !== workspace ||
        result.data.source_run_id !== body.source_run_id ||
        !sameScenarioHead(result.data.current_head, body.expected_head)
      )
        throw new ScenarioError(502, "INVALID_RESPONSE");
      return result.data;
    },
    async verifyLiveCase(
      created: DTO.LiveCreated,
      factoryId: string,
      options?: ReadOptions,
    ) {
      const response = await operations.getDecisionCase(
        created.decision_case_id,
        options,
      );
      if (
        response.meta?.factory_id !== factoryId ||
        response.caseStatus.decision_case_id !== created.decision_case_id ||
        response.caseStatus.mode !== "LIVE" ||
        response.caseStatus.snapshot_id !== created.current_head.snapshot_id
      )
        throw new ScenarioError(502, "CONTEXT_MISMATCH");
      return created;
    },
  };
}
export type ScenarioClient = ReturnType<typeof createScenarioClient>;
export const scenarioApi = createScenarioClient();
