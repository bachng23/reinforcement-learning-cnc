import { RecommendationCenterPage } from "@/components/pages/recommendation-center-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ caseId?: string | string[] }>;
}) {
  const params = await searchParams;
  const caseId = Array.isArray(params.caseId) ? params.caseId[0] : params.caseId;
  return <RecommendationCenterPage caseId={caseId} />;
}
