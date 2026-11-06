import { DemoWorkspace } from '@/components/simulation/demo-workspace';
import { DecisionCenterPage } from '@/components/pages/decision-center-page';
export default async function Page({searchParams}:{searchParams:Promise<{session?:string;machine?:string}>}) {
  const {session,machine}=await searchParams;
  if(machine && !session) return <DecisionCenterPage initialMachine={machine} />;
  return <DemoWorkspace view="decision" initialId={session} />;
}
