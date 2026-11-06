import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "@/components/pages/admin-page";
import { authFetch, getUserFromToken } from "@/lib/auth";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: redirect }),
}));
vi.mock("@/lib/auth", () => ({
  authFetch: vi.fn(),
  getUserFromToken: vi.fn(),
  endpoint: (path: string) => path,
}));
const records = [
  {
    id: "u1",
    fullName: "Alex Chen",
    username: "alex",
    role: "ENGINEER",
    active: true,
  },
  {
    id: "u2",
    fullName: "Maya Ng",
    username: "maya",
    role: "VIEWER",
    active: false,
  },
];
const response = (data: unknown) =>
  ({ ok: true, json: async () => ({ data }) }) as Response;

beforeEach(() => {
  redirect.mockClear();
  vi.mocked(getUserFromToken).mockResolvedValue({ id: "admin", role: "ADMIN" });
  vi.mocked(authFetch).mockImplementation(async (_url, init) =>
    response(init?.method === "DELETE" ? {} : records),
  );
});

describe("Administration workflow", () => {
  it("denies controls to non-administrators without requesting user data", async () => {
    vi.mocked(getUserFromToken).mockResolvedValue({
      id: "viewer",
      role: "VIEWER",
    });
    render(<AdminPage />);
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("/"));
    expect(authFetch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Add user" }),
    ).not.toBeInTheDocument();
  });

  it("filters the directory and keeps the active switch keyboard accessible", async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("Alex Chen");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter users by role" }),
      "ENGINEER",
    );
    expect(screen.queryByText("Maya Ng")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Alex Chen" }));
    const toggle = screen.getByRole("switch", { name: "Account active" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation before deactivating and preserves the record", async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await user.click(
      await screen.findByRole("button", { name: "Deactivate Alex Chen" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Deactivate Alex Chen?" }),
    ).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Deactivate account" }),
    );
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith(
        "/api/v1/users/u1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Activate Alex Chen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Chen")).toBeInTheDocument();
  });
});
