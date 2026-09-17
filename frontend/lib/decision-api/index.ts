import { HttpDecisionApiClient } from "@/lib/decision-api/client";
import { MockDecisionApiClient } from "@/lib/decision-api/mock";
import { getProductApiMode } from "@/lib/product-api";
import type { DecisionApiClient } from "@/types/decision";

let client: DecisionApiClient | undefined;
let mode: "mock" | "real" | undefined;

export function getDecisionApiClient(): DecisionApiClient {
  const nextMode = getProductApiMode();
  if (!client || mode !== nextMode) {
    client = nextMode === "mock" ? new MockDecisionApiClient() : new HttpDecisionApiClient();
    mode = nextMode;
  }
  return client;
}

export function resetDecisionApiClient(): void {
  client = undefined;
  mode = undefined;
}

export { HttpDecisionApiClient } from "@/lib/decision-api/client";
export { MockDecisionApiClient } from "@/lib/decision-api/mock";
