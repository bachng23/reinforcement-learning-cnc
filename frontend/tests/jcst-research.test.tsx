import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LearningCurve } from '@/components/research/learning-curve';
import { StateView } from '@/components/research/episode-replay';
import { ResearchOverview } from '@/components/research/research-overview';
import { ImportEvidence } from '@/components/research/import-evidence';
import { researchApi, researchRequest } from '@/lib/research-api/client';
import fixture from '../../contracts/jcst/v1/fixtures/engineering-bundle.json';
import type { Record as TickRecord } from '@/types/generated/jcst';
vi.mock('@/components/app-shell',()=>({ AppShell:({children}:{children:React.ReactNode})=><>{children}</> }));
vi.mock('next/navigation',()=>({usePathname:()=>'/research',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace:vi.fn()})}));
vi.mock('@/lib/research-api/client',()=>({researchApi:{campaigns:vi.fn()},researchRequest:vi.fn()}));

describe('JCST research presentation',()=>{
  it('shows API errors and empty data without substituting a demo campaign',async()=>{
    vi.mocked(researchApi.campaigns).mockRejectedValueOnce(new Error('Database unavailable'));
    render(<ResearchOverview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    vi.mocked(researchApi.campaigns).mockResolvedValueOnce([]);
    await userEvent.click(screen.getByRole('button',{name:'Try again'}));
    expect(await screen.findByText('No campaigns imported')).toBeInTheDocument();
    expect(screen.queryByText('JCST SE1 sample efficiency')).not.toBeInTheDocument();
  });
  it('preserves component failure and technician occupancy in recorded after-state',()=>{
    const record=structuredClone(fixture.episodes[0].records[0]) as unknown as TickRecord;
    record.after.components[0][1].failed=true;
    record.after.jobs[0]={machine:1,component:0,technician:0,kind:'CM',remaining:2};
    render(<StateView record={record} />);
    expect(screen.getByText('Breakdown')).toBeInTheDocument();
    expect(screen.getByText('C2: age 1 · FAILED')).toBeInTheDocument();
    expect(screen.getByText(/CM M2\/C1 · 2 ticks remaining/)).toBeInTheDocument();
  });
  it('does not fabricate missing time data or merge stochastic curves into the primary greedy view',()=>{
    const {rerender}=render(<LearningCurve axis="time" points={[{case_id:'base',arm:'A',training_root:'0',samples:24000,mode:'greedy',mean_total_cost:700}]} />);
    expect(screen.getByText('No measured training time data available.')).toBeInTheDocument();
    rerender(<LearningCurve points={[{case_id:'base',arm:'A',training_root:'0',samples:24000,mode:'stochastic',mean_total_cost:700}]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('keeps an import retry on the same idempotency identity after a transport failure',async()=>{
    vi.mocked(researchRequest).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({id:'job1',status:'QUEUED'});
    render(<ImportEvidence />); const user=userEvent.setup();
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'{"campaign_key":"example"}'}});
    await user.click(screen.getByRole('button',{name:'Queue validated import'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    await user.click(screen.getByRole('button',{name:'Queue validated import'}));
    await waitFor(()=>expect(researchRequest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(researchRequest).mock.calls[0][1]?.key).toBe(vi.mocked(researchRequest).mock.calls[1][1]?.key);
  });
});
