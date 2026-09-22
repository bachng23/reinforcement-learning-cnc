import { createOperationsApiClient, type OperationsApiClient } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";

export type OperationsApiMode = "mock" | "real";

const DEFAULT_FACTORY_ID = "factory-demo-01";
let client: OperationsApiClient | undefined;
let activeMode: OperationsApiMode | undefined;

export function getOperationsApiMode(): OperationsApiMode {
  const configured = process.env.NEXT_PUBLIC_OPERATIONS_API_MODE?.trim().toLowerCase();
  if (!configured || configured === "mock") return "mock";
  if (configured === "real") return "real";
  throw new Error(
    `Unsupported NEXT_PUBLIC_OPERATIONS_API_MODE "${configured}". Use "mock" or "real".`,
  );
}

export function getOperationsFactoryId(): string {
  return process.env.NEXT_PUBLIC_OPERATIONS_FACTORY_ID?.trim() || DEFAULT_FACTORY_ID;
}

/** Returns one stable adapter for the configured Operations read mode. */
export function getOperationsApiClient(): OperationsApiClient {
  const mode = getOperationsApiMode();
  if (!client || activeMode !== mode) {
    client = mode === "mock"
      ? createMockOperationsApiClient()
      : createOperationsApiClient();
    activeMode = mode;
  }
  return client;
}

/** Test helper; production callers should use getOperationsApiClient(). */
export function resetOperationsApiClient(): void {
  client = undefined;
  activeMode = undefined;
}

export {
  createOperationsApiClient,
  OperationsApiError,
  type OperationsApiClient,
} from "@/lib/operations-api/client";
export { createMockOperationsApiClient } from "@/lib/operations-api/mock";
