import { IncidentsPage } from "@/components/pages/incidents-page";
import { getOperationsFactoryId } from "@/lib/operations-api";
import type { Query } from "@/lib/incidents/client";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query: Query = { factory_id: getOperationsFactoryId() };
  for (const key of ["factory_id", "q", "status", "severity", "owner_user_id", "machine_id", "cursor", "limit"] as const) {
    const value = params[key];
    if (typeof value === "string") query[key] = value;
  }
  return <IncidentsPage key={JSON.stringify(query)} query={query} />;
}
