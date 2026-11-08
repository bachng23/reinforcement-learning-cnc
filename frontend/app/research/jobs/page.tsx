import { ResearchJobs } from '@/components/research/research-jobs';
import { Suspense } from 'react';
export default function Page() { return <Suspense fallback={<p>Loading research jobs…</p>}><ResearchJobs /></Suspense>; }
