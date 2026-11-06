import { describe, expect, it, vi } from "vitest";
import contract from "../../contracts/v3/operations-http.openapi.json";
import generated from "@/types/generated/work-orders.schema.json";
import example from "../../backend/examples/work-orders.json";
import { createWorkOrdersClient, errorExplanation, WorkOrdersError } from "@/lib/work-orders/client";
import { buildWorkOrderCommand, emptyCommandDraft, type CommandName } from "@/lib/work-orders/commands";
import { parseWorkOrderQuery, workOrderReturnHref, workOrdersHref } from "@/lib/work-orders/navigation";
import { eventsExample, workOrderExample, workOrderListExample } from "./work-order-fixtures";

describe("Work Orders producer contract transport", () => {
  it("generates every WorkOrder schema without a parallel model, preserving nulls and exact producer command variants", () => {
    const definitions = Object.fromEntries(Object.entries(contract.components.schemas).filter(([key]) => key.startsWith("WorkOrder")));
    expect(generated.definitions).toEqual(JSON.parse(JSON.stringify(definitions).replaceAll("#/components/schemas/", "#/definitions/")));
  });
  it("sends only supported list filters, keeps opaque cursor/meta and supports cancellation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(workOrderListExample()));
    const api = createWorkOrdersClient({ fetcher, baseUrl: "https://api.test/api/v1" });
    const signal = new AbortController().signal;
    const response = await api.list({ factory_id: "factory-A", status: "UNASSIGNED", machine_id: "M03", overdue: "false", limit: 25, cursor: "opaque+cursor:microseconds" }, { signal });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ factory_id: "factory-A", status: "UNASSIGNED", machine_id: "M03", overdue: "false", limit: "25", cursor: "opaque+cursor:microseconds" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "include", signal });
    expect(response.meta).toEqual(example.list.meta);
  });
  it("rejects malformed, cross-factory and mismatched filter data rather than showing rows", async () => {
    const body = workOrderListExample(); body.data[0].factory_id = "factory-B";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(Response.json(workOrderListExample())).mockResolvedValueOnce(Response.json({ success: true, data: [] }));
    const api = createWorkOrdersClient({ fetcher });
    await expect(api.list({ factory_id: "factory-A" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.list({ factory_id: "factory-A", status: "CLOSED" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.list({ factory_id: "factory-A" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects wrong detail/source identity and event gaps/duplicates", async () => {
    const detail = workOrderExample(); detail.data.source.basis_snapshot_id = "wrong";
    const gap = eventsExample(); gap.data[0].sequence = 2;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(detail)).mockResolvedValueOnce(Response.json(gap));
    const api = createWorkOrdersClient({ fetcher });
    await expect(api.detail(detail.data.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(api.events(detail.data.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("scopes bounded known-ID summaries and refuses reordered or missing identities", async () => {
    const detail = workOrderExample(); const list = workOrderListExample();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ success: true, data: list.data, meta: detail.meta })).mockResolvedValueOnce(Response.json({ success: true, data: [], meta: detail.meta }));
    const api = createWorkOrdersClient({ fetcher });
    expect((await api.summaries(detail.data.factory_id, [detail.data.id])).data[0].id).toBe(detail.data.id);
    await expect(api.summaries(detail.data.factory_id, [detail.data.id])).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([401, 403, 404, 409, 503])("retains safe %s code/requestId without exposing raw reports", async status => {
    const api = createWorkOrdersClient({ fetcher: vi.fn().mockResolvedValue(Response.json({ success: false, error: { code: "TEST_REJECTION", message: "Sensitive stack/report" }, requestId: "support-123" }, { status })) });
    const error = await api.detail(workOrderExample().data.id).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status, requestId: "support-123", code: "TEST_REJECTION" });
    expect(errorExplanation(error as WorkOrdersError)).not.toContain("Sensitive");
  });
  it("writes exact generated create/command bodies with key and never sends caller timestamps", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(workOrderExample()));
    const api = createWorkOrdersClient({ fetcher });
    await api.create(example.create_request, { key: "create-123" });
    await api.command(example.created.data.id, { command: "START", expected_revision: 5 }, { key: "start-123" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(example.create_request);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ "Idempotency-Key": "create-123" });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ command: "START", expected_revision: 5 });
    await expect(api.create(example.create_request, { key: "" })).rejects.toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("commands and committed navigation", () => {
  it.each(["ASSIGN", "ACCEPT", "START", "BLOCK", "RESUME", "COMPLETE", "CLOSE", "REQUEST_REWORK", "CANCEL", "REASSIGN", "MANAGER_HOLD", "REASSIGN_FOR_REWORK"] as CommandName[])("builds %s from the read revision, not a frontend transition", command => {
    const result = buildWorkOrderCommand(command, 12, { ...emptyCommandDraft, reason: "  Reviewed situation  ", assignee: "b0000000-0000-4000-8000-000000000002", work: "Inspected", result: "Recorded outcome", note: "Independent review" });
    expect(result).toMatchObject({ command, expected_revision: 12 });
    expect(result).not.toHaveProperty("status"); expect(result).not.toHaveProperty("actual_started_at");
    if (command === "MANAGER_HOLD") expect(result).not.toHaveProperty("assignee_user_id");
  });
  it("validates STOPPED, whitespace-only required text and independent verification note", () => {
    expect(() => buildWorkOrderCommand("COMPLETE", 1, { ...emptyCommandDraft, outcome: "STOPPED", work: "Work", result: "Partial", stopReason: " " })).toThrow("stop reason");
    expect(() => buildWorkOrderCommand("BLOCK", 1, { ...emptyCommandDraft, reason: " " })).toThrow("reason");
    expect(() => buildWorkOrderCommand("CLOSE", 1, emptyCommandDraft)).toThrow("verification note");
    expect(buildWorkOrderCommand("COMPLETE", 1, { ...emptyCommandDraft, outcome: "STOPPED", work: "Work", result: "Stopped", stopReason: "  Unsafe access  " })).toMatchObject({ report: { stop_reason: "Unsafe access" } });
  });
  it("preserves opaque cursor and exact URL scope, rejects external or cross-factory return paths", () => {
    const query = parseWorkOrderQuery({ factory_id: "factory-A", status: "ACCEPTED", machine_id: "historical-M03", overdue: "true", limit: "50", cursor: "signed.opaque" }, "fallback");
    const href = workOrdersHref(query);
    expect(workOrderReturnHref(href, "factory-A")).toBe(href);
    expect(workOrderReturnHref(href, "factory-B")).toBe("/operations/work-orders?factory_id=factory-B");
    expect(workOrderReturnHref("https://attacker.test/operations/work-orders?factory_id=factory-A", "factory-A")).toBe("/operations/work-orders?factory_id=factory-A");
    expect(workOrderReturnHref("https://[invalid", "factory-A")).toBe("/operations/work-orders?factory_id=factory-A");
    expect(new URL(href, "http://localhost").searchParams.get("cursor")).toBe("signed.opaque");
  });
});
