import { CampaignWorkspace } from '@/components/research/campaign-workspace';
import { Suspense } from 'react';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <Suspense fallback={<p>Loading campaign…</p>}><CampaignWorkspace id={id} /></Suspense>;
}
