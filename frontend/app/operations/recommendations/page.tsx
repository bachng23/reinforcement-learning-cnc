import { RecommendationCenterPage } from "@/components/pages/recommendation-center-page";
import { firstParam, productionMode } from "@/lib/operations-ui";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ caseId?: string | string[]; factory_id?: string | string[]; demo?: string | string[] }>;
}) {
  const params = await searchParams;
  const caseId = Array.isArray(params.caseId) ? params.caseId[0] : params.caseId;
  return <RecommendationCenterPage key={JSON.stringify(params)} caseId={caseId} factoryHint={firstParam(params.factory_id)} apiMode={productionMode(params.demo)} />;
}
