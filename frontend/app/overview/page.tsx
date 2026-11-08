import { DemoWorkspace } from '@/components/simulation/demo-workspace';
import { DashboardPage } from '@/components/pages/production-dashboard-page';
import { firstParam, productionMode } from '@/lib/operations-ui';
export default async function Page({searchParams}:{searchParams:Promise<{session?:string;factory_id?:string|string[];demo?:string|string[]}>}) {
  const params=await searchParams;
  if (params.factory_id !== undefined || params.demo !== undefined) return <DashboardPage key={JSON.stringify(params)} factoryId={firstParam(params.factory_id)} apiMode={productionMode(params.demo)} />;
  return <DemoWorkspace view="overview" initialId={params.session} />;
}
