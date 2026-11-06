import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/components/pages/login-page";
import { deferred } from "@/tests/product-api-test-utils";

describe("Sign-in workflow", () => {
  it("submits once while pending and exposes password visibility", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const submit = vi.fn(() => pending.promise);
    render(<LoginPage onSubmit={submit} />);
    await user.type(
      screen.getByRole("textbox", { name: "Username" }),
      "  alex  ",
    );
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("alex", "password123");
    pending.resolve();
  });

  it("shows a returned sign-in error and allows correction", async () => {
    const user = userEvent.setup();
    render(
      <LoginPage
        onSubmit={vi.fn(async () => {
          throw new Error("Credentials could not be verified.");
        })}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "Username" }), "alex");
    await user.type(screen.getByLabelText("Password"), "incorrect");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Credentials could not be verified.",
    );
    await user.type(screen.getByLabelText("Password"), "1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
