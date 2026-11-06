import { DemoWorkspace } from '@/components/simulation/demo-workspace';
export default async function Page({searchParams}:{searchParams:Promise<{session?:string}>}) {
  const {session}=await searchParams;
  return <DemoWorkspace view="overview" initialId={session} />;
}
