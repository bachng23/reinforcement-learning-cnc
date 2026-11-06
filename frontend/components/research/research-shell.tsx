"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, FlaskConical, FolderOpen, ListChecks, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';

const tabs = [
  { href: '/research', label: 'Campaigns', icon: FolderOpen },
  { href: '/research/import', label: 'Import evidence', icon: Upload },
  { href: '/research/jobs', label: 'Jobs & reviews', icon: ListChecks },
];

export function ResearchShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const pathname = usePathname();
  return <AppShell title={title}><main className="research-workspace">
    <header className="research-heading">
      <div><p className="research-eyebrow"><FlaskConical size={14} aria-hidden="true" /> Maintenance demand · Technician capacity</p>
        <h1>{title}</h1><p className="research-description">{description}</p></div>
      <a href="https://github.com/AIVIETNAM-AIO-BachNguyen/maintenance-capacity-coordination" target="_blank" rel="noreferrer" className="research-source-link">Research repository <ArrowUpRight size={14} aria-hidden="true" /></a>
    </header>
    <nav aria-label="Research" className="research-tabs">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = href === '/research' ? pathname === href || pathname.startsWith('/research/campaigns/') || pathname.startsWith('/research/episodes/') : pathname === href;
        return <Link aria-current={active ? 'page' : undefined} key={href} href={href}><Icon size={15} aria-hidden="true" />{label}</Link>;
      })}
    </nav><div className="research-content">{children}</div>
  </main></AppShell>;
}

export function EvidenceBadge({ children }: { children: ReactNode }) {
  return <span className="evidence-badge">{children}</span>;
}
