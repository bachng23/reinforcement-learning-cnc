import { WorkOrdersPage } from "@/components/pages/work-orders-page";
import { getOperationsFactoryId } from "@/lib/operations-api";
import { parseWorkOrderQuery } from "@/lib/work-orders/navigation";
import { firstParam } from "@/lib/operations-ui";
import { WorkOrdersPreviewUnavailable } from "@/components/work-orders/work-orders-preview-unavailable";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (firstParam(params.demo) === "1") return <WorkOrdersPreviewUnavailable factoryId={firstParam(params.factory_id)} />;
  return <WorkOrdersPage key={JSON.stringify(params)} query={parseWorkOrderQuery(params, getOperationsFactoryId())} />;
}
