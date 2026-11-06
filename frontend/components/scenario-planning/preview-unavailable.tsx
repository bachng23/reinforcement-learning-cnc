import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { scenarioHref } from "@/lib/scenario-planning/navigation";
export function ScenarioPreviewUnavailable({
  factoryId,
}: {
  factoryId: string;
}) {
  return (
    <AppShell
      title="Scenario Planning · preview boundary"
      factoryId={factoryId}
      demo
    >
      <main className="mx-auto max-w-4xl space-y-5 p-8">
        <h1 className="text-2xl font-semibold">
          Scenario Planning is live-only
        </h1>
        <p>
          Preview navigation never becomes permission to read or write live
          Scenario workspaces. Choose the production workspace explicitly.
        </p>
        <div className="flex gap-3">
          <Link className="dss-primary" href={scenarioHref(factoryId)}>
            Open live Scenario Planning
          </Link>
          <Link
            className="dss-secondary"
            href={`/operations/what-if?factory_id=${encodeURIComponent(factoryId)}&demo=1`}
          >
            Open legacy fixture preview
          </Link>
        </div>
      </main>
    </AppShell>
  );
}
