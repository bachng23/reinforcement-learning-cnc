import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceUser } from "@/lib/workspace-user";
import { AppShell } from "@/components/app-shell";
import { operationsHref, productionMode } from "@/lib/operations-ui";
const navigation = vi.hoisted(() => ({ pathname: "/operations/cases", router: { replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => navigation.router }));
vi.mock("@/lib/auth", () => ({ getUserFromToken: async () => ({ id: "engineer", role: "ENGINEER" }), logout: vi.fn() }));

function AccessProbe(){const user=useWorkspaceUser();return <p>{user?.role === "ENGINEER" ? "Engineer context available" : "No engineer context"}</p>;}

describe("production navigation and explicit source scope", () => {
  it.each(["/operations/cases", "/operations/recommendations"])("marks Decision Center active for %s and keeps research secondary", async pathname => {
    navigation.pathname = pathname;
    render(<AppShell factoryId="factory with / opaque chars" demo><AccessProbe/></AppShell>);
    expect(await screen.findByText("Engineer context available")).toBeInTheDocument();
    const nav = within(await screen.findByRole("navigation", { name: "Primary navigation" }));
    expect(nav.getByRole("link", { name: "Decision Center" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Decision Center" })).toHaveAttribute("href", "/operations/cases?factory_id=factory+with+%2F+opaque+chars&demo=1");
    expect(nav.getAllByRole("link", { name: "Simulation" })).toHaveLength(1);
    expect(nav.queryByRole("link", {name:"Overview"})).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "Factory operations" })).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Research workspace" })).toHaveAttribute("href", "/research");
  });

  it("never implicitly selects demo and preserves URL query/hash while encoding case/factory identity", () => {
    expect(productionMode()).toBe("real");
    expect(productionMode("true")).toBe("real");
    expect(productionMode("1")).toBe("mock");
    const url = new URL(operationsHref("/operations/recommendations?keep=yes#evidence", "F 2", { caseId: "opaque/case", demo: true }), "http://localhost");
    expect(url.searchParams.get("factory_id")).toBe("F 2");
    expect(url.searchParams.get("caseId")).toBe("opaque/case");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.hash).toBe("#evidence");
  });
});
