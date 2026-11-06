import { OperationsOverviewPage } from "@/components/pages/operations-overview-page";
import { getOperationsFactoryId } from "@/lib/operations-api";
import { firstParam, productionMode } from "@/lib/operations-ui";

export default async function Page({ searchParams }: { searchParams: Promise<{ factory_id?: string | string[]; demo?: string | string[] }> }) {
  const params = await searchParams;
  return <OperationsOverviewPage key={JSON.stringify(params)} factoryId={firstParam(params.factory_id) ?? getOperationsFactoryId()} apiMode={productionMode(params.demo)} />;
}
