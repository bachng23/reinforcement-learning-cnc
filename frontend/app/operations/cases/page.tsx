import { DecisionCasesPage } from "@/components/pages/decision-cases-page";
import { getOperationsFactoryId } from "@/lib/operations-api";
import { isDecisionCaseStatus } from "@/lib/operations-api/decision-case-reads";
import { productionMode } from "@/lib/operations-ui";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ factory_id?: string | string[]; status?: string | string[]; mode?: string | string[]; demo?: string | string[] }>;
}) {
  const params = await searchParams;
  const first = (value?: string | string[]) => Array.isArray(value) ? value[0] : value;
  const status = first(params.status) ?? "";
  const mode = first(params.mode);
  return <DecisionCasesPage key={JSON.stringify(params)} apiMode={productionMode(params.demo)} initialQuery={{ factory_id: first(params.factory_id) ?? getOperationsFactoryId(), limit: 25,
    ...(isDecisionCaseStatus(status) ? { status } : {}), ...(mode === "LIVE" || mode === "SIMULATION_ONLY" ? { mode } : {}) }} />;
}
