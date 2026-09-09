"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FlaskConical, LogOut, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ErrorBoundary } from "@/components/error-boundary";
import { getUserFromToken, logout, type TokenUser } from "@/lib/auth";

type AppShellProps = {
  children: ReactNode;
  title?: string;
};

function NavItem({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof FlaskConical;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
      style={{
        background: active ? "var(--color-sky-tint)" : "transparent",
        color: active ? "var(--color-slate-text)" : "var(--color-ash-gray)",
      }}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children, title = "Research overview" }: AppShellProps) {
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
          Opening the research workspace…
        </div>
      </div>
    );
  }

  const displayName = user.fullName || user.username || user.role;

  return (
    <div className="min-h-screen bg-[var(--color-canvas-fog)] lg:flex">
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-white lg:flex"
        style={{ borderColor: "var(--color-stone-border)" }}
      >
        <Link href="/" className="flex h-16 items-center gap-3 px-5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-slate-text)] text-white">
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-[var(--color-slate-text)]">CNC Research Console</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-3" aria-label="Primary navigation">
          <NavItem href="/experiments" label="Experiments" icon={FlaskConical} />
          {user.role === "ADMIN" && <NavItem href="/admin" label="Users" icon={Users} />}
        </nav>

        <div className="border-t px-4 py-4" style={{ borderColor: "var(--color-stone-border)" }}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--color-slate-text)]">{displayName}</p>
              <p className="text-xs text-[var(--color-ash-gray)]">{user.role}</p>
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
            <Link href="/experiments" aria-label="Experiments" title="Experiments" className="grid h-9 w-9 place-items-center rounded-md">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
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
    </div>
  );
}
