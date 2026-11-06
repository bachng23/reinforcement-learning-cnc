import { WorkOrderDetailPage } from "@/components/pages/work-order-detail-page";
import { firstParam } from "@/lib/operations-ui";
import { WorkOrdersPreviewUnavailable } from "@/components/work-orders/work-orders-preview-unavailable";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ factory_id?: string | string[]; returnTo?: string | string[]; demo?: string | string[] }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (firstParam(query.demo) === "1") return <WorkOrdersPreviewUnavailable factoryId={firstParam(query.factory_id)} />;
  return <WorkOrderDetailPage key={`${id}:${JSON.stringify(query)}`} id={id} factoryHint={firstParam(query.factory_id)} returnTo={firstParam(query.returnTo)} />;
}
