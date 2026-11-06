import { IntegratedSchedulePage } from "@/components/pages/integrated-schedule-page";
import { getOperationsFactoryId } from "@/lib/operations-api";
import { firstParam, productionMode } from "@/lib/operations-ui";

export default async function Page({ searchParams }: { searchParams: Promise<{ factory_id?: string | string[]; demo?: string | string[]; caseId?: string | string[]; schedule_id?: string | string[]; schedule_revision?: string | string[]; assignment_id?: string | string[] }> }) {
  const params = await searchParams;
  const hasSource = params.schedule_id !== undefined || params.schedule_revision !== undefined || params.assignment_id !== undefined;
  return <IntegratedSchedulePage key={JSON.stringify(params)} factoryId={firstParam(params.factory_id) ?? (firstParam(params.caseId) ? undefined : getOperationsFactoryId())} caseId={firstParam(params.caseId)} apiMode={productionMode(params.demo)} sourceHint={hasSource ? { scheduleId: firstParam(params.schedule_id) ?? "", revision: firstParam(params.schedule_revision) ?? "", assignmentId: firstParam(params.assignment_id) ?? "" } : undefined} />;
}
