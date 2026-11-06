import { IncidentDetailPage } from "@/components/pages/incident-detail-page";
import { getOperationsFactoryId } from "@/lib/operations-api";
export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ factory_id?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const factoryId = typeof query.factory_id === "string" ? query.factory_id : getOperationsFactoryId();
  return <IncidentDetailPage key={factoryId + ":" + id} id={id} factoryId={factoryId} />;
}
