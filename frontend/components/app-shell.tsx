"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardCheck, Factory, FlaskConical, LogOut, Users, LayoutDashboard } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ErrorBoundary } from "@/components/error-boundary";
import { getUserFromToken, logout, type TokenUser } from "@/lib/auth";
import { operationsHref } from "@/lib/operations-ui";
import { WorkspaceUserContext } from "@/lib/workspace-user";

type AppShellProps = {
  children: ReactNode;
  title?: string;
  factoryId?: string;
  demo?: boolean;
};

function NavItem({
  href,
  label,
  icon: Icon,
  activePaths,
}: {
  href: string;
  label: string;
  icon: typeof FlaskConical;
  activePaths?: string[];
}) {
  const pathname = usePathname();
  const route = href.split("?")[0];
  const active = activePaths ? activePaths.some(path => pathname === path || pathname.startsWith(`${path}/`)) : pathname === route || (route !== "/" && pathname.startsWith(`${route}/`));

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
      style={{
        background: active ? "#1e40af" : "transparent",
        color: active ? "#ffffff" : "#cbd5e1",
      }}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children, title = "Production DSS", factoryId, demo = false }: AppShellProps) {
  const router = useRouter();
  const [user, setUser] = useState<TokenUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getUserFromToken().then((currentUser) => {
      if (cancelled) return;
      if (!currentUser) {
        router.replace("/login");
        return;
      }
      setUser(currentUser);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--color-canvas-fog)] px-4">
        <div role="status" className="flex items-center gap-3 text-sm text-[var(--color-ash-gray)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-stone-border)] border-t-[var(--color-chartwell-blue)]" />
          Opening the workspace…
        </div>
      </div>
    );
  }

  const displayName = user.fullName || user.username || user.role;
  const href = (path: string) => operationsHref(path, factoryId, { demo });

  return (
    <WorkspaceUserContext.Provider value={user}><div className="min-h-screen bg-[var(--color-canvas-fog)] lg:flex">
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950 text-slate-100 lg:flex"
      >
        <Link href={href("/overview")} className="flex h-20 items-center gap-3 border-b border-slate-800 px-5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-slate-text)] text-white">
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-white">CNC Decision Support<span className="mt-1 block text-[10px] font-normal uppercase tracking-widest text-slate-400">Factory workspace</span></span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-3" aria-label="Primary navigation">
          <p className="px-3 pb-2 pt-4 text-[10px] uppercase tracking-widest text-slate-400">Operations</p>
          <NavItem href={href("/overview")} label="Overview" icon={LayoutDashboard} activePaths={["/overview"]} />
          <NavItem href={href("/operations/cases")} label="Decision Center" icon={ClipboardCheck} activePaths={["/operations/cases", "/operations/recommendations"]} />
          <NavItem href={href("/operations/incidents")} label="Incident Center" icon={ClipboardCheck} />
          <NavItem href={href("/operations/work-orders")} label="Work Orders" icon={ClipboardCheck} activePaths={["/operations/work-orders"]} />
          <NavItem href={href("/operations/scenarios")} label="Scenario Planning" icon={FlaskConical} activePaths={["/operations/scenarios"]} />
          <div className="pt-8"><p className="px-3 pb-2 text-[10px] uppercase tracking-widest text-slate-400">Research / administration</p></div>
          <NavItem href="/experiments" label="Experiments · research v2" icon={FlaskConical} />
          <NavItem href="/decisions" label="Decisions · research v2" icon={ClipboardCheck} />
          <NavItem href="/operations/agents" label="Agents · research/demo" icon={FlaskConical} />
          {user.role === "ADMIN" && <NavItem href="/admin" label="Users" icon={Users} />}
        </nav>

        <div className="border-t border-slate-800 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-100">{displayName}</p>
              <p className="text-xs text-slate-400">{user.role}</p>
            </div>
            <button
              type="button"
              aria-label="Log out"
              title="Log out"
              onClick={() => void logout()}
              className="grid h-9 w-9 place-items-center rounded-md border text-[var(--color-ash-gray)] transition-colors hover:bg-[var(--color-canvas-fog)]"
              style={{ borderColor: "var(--color-stone-border)" }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white px-4 sm:px-6 lg:px-8"
          style={{ borderColor: "var(--color-stone-border)" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <FlaskConical className="h-5 w-5 shrink-0 text-[var(--color-chartwell-blue)] lg:hidden" aria-hidden="true" />
            <h1 className="truncate text-base font-semibold text-[var(--color-slate-text)]">{title}</h1>
          </div>
          <div className="flex items-center gap-1 lg:hidden">
            <Link href={href("/overview")} aria-label="Overview" title="Overview" className="grid h-9 w-9 place-items-center rounded-md">
              <Factory className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/experiments" aria-label="Experiments" title="Experiments" className="grid h-9 w-9 place-items-center rounded-md">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href={href("/operations/cases")} aria-label="Decision Center" title="Decision Center" className="grid h-9 w-9 place-items-center rounded-md">
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            </Link>
            {user.role === "ADMIN" && (
              <Link href="/admin" aria-label="Users" title="Users" className="grid h-9 w-9 place-items-center rounded-md">
                <Users className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <button type="button" aria-label="Log out" title="Log out" onClick={() => void logout()} className="grid h-9 w-9 place-items-center rounded-md">
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </div></WorkspaceUserContext.Provider>
  );
}
