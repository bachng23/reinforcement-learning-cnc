import { ScenarioWorkspacePage } from "@/components/pages/scenario-workspace-page";
import { ScenarioPreviewUnavailable } from "@/components/scenario-planning/preview-unavailable";
import { getOperationsFactoryId } from "@/lib/operations-api";
import { firstParam } from "@/lib/operations-ui";
import { parseScenarioSelection } from "@/lib/scenario-planning/navigation";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const selection = parseScenarioSelection(query, getOperationsFactoryId());
  if (firstParam(query.demo) === "1")
    return <ScenarioPreviewUnavailable factoryId={selection.factory_id} />;
  return (
    <ScenarioWorkspacePage
      key={`${route.workspaceId}:${selection.factory_id}`}
      workspaceId={route.workspaceId}
      selection={selection}
    />
  );
}
