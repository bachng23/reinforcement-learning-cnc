import { ScenarioWorkspacesPage } from "@/components/pages/scenario-workspaces-page";
import { ScenarioPreviewUnavailable } from "@/components/scenario-planning/preview-unavailable";
import { getOperationsFactoryId } from "@/lib/operations-api";
import { firstParam } from "@/lib/operations-ui";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const factoryId = firstParam(params.factory_id) ?? getOperationsFactoryId();
  if (firstParam(params.demo) === "1")
    return <ScenarioPreviewUnavailable factoryId={factoryId} />;
  return (
    <ScenarioWorkspacesPage
      key={JSON.stringify(params)}
      factoryId={factoryId}
      cursor={firstParam(params.cursor)}
    />
  );
}
