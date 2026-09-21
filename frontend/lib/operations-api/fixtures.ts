import request from "../../../contracts/v3/fixtures/demo-health-alert.json";
import status from "../../../contracts/v3/fixtures/demo-case-status.json";
import type { RunDecisionCaseRequest, DecisionCaseStatusResponse } from "@/types/generated/operations";

// JSON imports widen enum strings. The contract gate validates these files with
// canonical Pydantic models; consumers get a fresh copy to avoid test pollution.
export function createOperationsDemoFixtures() {
  return {
    request: structuredClone(request) as RunDecisionCaseRequest,
    status: structuredClone(status) as DecisionCaseStatusResponse,
  };
}
