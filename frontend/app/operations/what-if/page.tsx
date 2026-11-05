import { WhatIfWorkspacePage } from "@/components/pages/what-if-workspace-page";
import { redirect } from "next/navigation";
import { getOperationsFactoryId } from "@/lib/operations-api";
import { firstParam } from "@/lib/operations-ui";
import { scenarioHref } from "@/lib/scenario-planning/navigation";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (firstParam(params.demo) === "1") return <WhatIfWorkspacePage />;
  redirect(scenarioHref(firstParam(params.factory_id) ?? getOperationsFactoryId()));
}
