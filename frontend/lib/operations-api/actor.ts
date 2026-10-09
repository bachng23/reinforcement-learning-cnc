import { authFetch, endpoint } from "@/lib/auth";
import { OperationsApiError, type OperationsRequestOptions } from "./client";

/** Recovery receipts are actor-scoped. Never replay another signed-in actor's journal. */
export async function getOperationsActorId(options: OperationsRequestOptions): Promise<string> {
  const response = await authFetch(endpoint("/api/v1/auth/me"), { signal: options.signal, cache: "no-store" });
  if (!response.ok) throw new OperationsApiError(response.status, null);
  const body = await response.json() as { success?: boolean; user?: { id?: string; role?: string } };
  if (body.success !== true || !body.user?.id || !["OPERATOR", "ENGINEER", "ADMIN"].includes(body.user.role ?? "")) {
    throw new OperationsApiError(403, null);
  }
  return body.user.id;
}
