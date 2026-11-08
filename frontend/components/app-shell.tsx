"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { WorkspaceUserContext } from "@/lib/workspace-user";
import { operationsHref } from "@/lib/operations-ui";
import { ErrorBoundary } from "@/components/error-boundary";
import { getUserFromToken, logout, type TokenUser } from "@/lib/auth";

const navigation = [
  {
    href: "/simulation",
    label: "Simulation",
    icon: Activity,
    activePaths: ["/overview", "/operations"],
  },
  {href:"/dashboard",label:"Dashboard",icon:LayoutDashboard},
  { href: "/decisions", label: "Decision Center", icon: ClipboardCheck, activePaths:["/operations/cases","/operations/recommendations"] },
  { href: "/agents", label: "Decision activity", icon: Bot },
  { href: "/what-if", label: "Compare controllers", icon: SlidersHorizontal },
];

function NavItem({
  href,
  label,
  icon: Icon,
  collapsed,
  activePaths = [],
}: {
  href: string;
  label: string;
  icon: typeof Activity;
  collapsed: boolean;
  activePaths?: string[];
}) {
  const pathname = usePathname();
  const baseHref = href.split("?")[0];
  const active =
    pathname === baseHref ||
    pathname.startsWith(`${baseHref}/`) ||
    activePaths.includes(pathname);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={`workspace-nav-link ${active ? "is-active" : ""}`}
    >
      <Icon size={19} aria-hidden="true" />
      <span className={collapsed ? "sr-only" : undefined}>{label}</span>
    </Link>
  );
}

export function AppShell({
  children,
  factoryId,
  demo = false,
  simulationId,
  workshopId,
}: {
  children: ReactNode;
  title?: string;
  factoryId?: string;
  demo?: boolean;
  simulationId?: string;
  workshopId?: string;
}) {
  const router = useRouter();
  const [user, setUser] = useState<TokenUser | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );

  useEffect(() => {
    try {
      if (localStorage.getItem("dss-density") === "compact")
        setDensity("compact");
    } catch {
      /* Use the default density when storage is unavailable. */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getUserFromToken().then((currentUser) => {
      if (cancelled) return;
      if (!currentUser) router.replace("/login");
      else setUser(currentUser);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!user)
    return (
      <div className="workspace-loading" role="status">
        <Activity size={24} aria-hidden="true" />
        <p>Opening your workspace…</p>
      </div>
    );
  const displayName = user.fullName || user.username || user.role;

  return (
    <WorkspaceUserContext.Provider value={user}><div
      className={`workspace-shell ${collapsed ? "sidebar-collapsed" : ""}`}
      data-density={density}
    >
      <a href="#workspace-content" className="skip-link">
        Skip to content
      </a>
      <aside className="workspace-sidebar" aria-label="Workspace sidebar">
        <Link
          href={simulationId ? `/simulation?session=${simulationId}${workshopId ? `&workshop=${workshopId}` : ""}` : "/simulation"}
          className="workspace-brand"
          title="Maintenance Coordination Workspace"
        >
          <span className="brand-symbol">
            <Activity size={23} aria-hidden="true" />
          </span>
          <span className={collapsed ? "sr-only" : "brand-name"}>
            MCC Workspace<span>Demand & capacity</span>
          </span>
        </Link>
        <nav aria-label="Primary navigation" className="workspace-navigation">
          <p className={collapsed ? "sr-only" : "nav-group-label"}>
            Application
          </p>
          {navigation.map((item) => (
            <NavItem key={item.href} {...item} href={factoryId && item.href === "/decisions" ? operationsHref("/operations/cases",factoryId,{demo}) : simulationId ? `${item.href}?session=${simulationId}${workshopId ? `&workshop=${workshopId}` : ""}` : item.href} collapsed={collapsed} />
          ))}
          {process.env.NEXT_PUBLIC_RESEARCH_ENABLED !== "false" && <>
            <p className={collapsed ? "sr-only" : "nav-group-label nav-group-secondary"}>Research</p>
            <NavItem href="/research" label="Research workspace" icon={FlaskConical} collapsed={collapsed} />
          </>}
          {user.role === "ADMIN" && (
            <>
            <p className={collapsed ? "sr-only" : "nav-group-label nav-group-secondary"}>
              Administration
            </p>
            <NavItem
              href="/admin"
              label="Users"
              icon={Users}
              collapsed={collapsed}
            />
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="workspace-nav-link sidebar-toggle"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight size={18} aria-hidden="true" />
            ) : (
              <ChevronLeft size={18} aria-hidden="true" />
            )}
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
          <div className="workspace-account">
            <span className="account-avatar" aria-hidden="true">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className={collapsed ? "sr-only" : "account-name"}>
              <p>{displayName}</p>
              <span>{user.role === "ADMIN" ? "Administrator" : user.role}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="workspace-nav-link"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={18} aria-hidden="true" />
            <span className={collapsed ? "sr-only" : undefined}>Log out</span>
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <div id="workspace-content" tabIndex={-1}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </div>
    </div></WorkspaceUserContext.Provider>
  );
}
