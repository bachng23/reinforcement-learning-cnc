import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AsyncState } from "@/components/research/async-state";
import { workOrdersHref } from "@/lib/work-orders/navigation";

/** Work Orders has no production preview adapter. Never reinterpret demo=1 as
 * permission to submit real maintenance writes. The user must choose live mode. */
export function WorkOrdersPreviewUnavailable({ factoryId }: { factoryId?: string }) {
  return <AppShell title="Work Orders · live-only" factoryId={factoryId} demo><main className="mx-auto max-w-5xl p-8"><AsyncState kind="empty" title="Work Orders is unavailable in preview mode" description="There is no fixture-backed Work Orders workflow. No Work Order API read or write is performed from this preview route. Choose the real workspace explicitly." action={<Link href={workOrdersHref({ factory_id: factoryId ?? "" })} className="dss-primary">Open real Work Orders</Link>} /></main></AppShell>;
}
