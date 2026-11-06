import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ReviewDialog } from "@/components/research/review-dialog";

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open review
      </button>
      {open && (
        <ReviewDialog
          labelledBy="dialog-title"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <h2 id="dialog-title">Confirm decision</h2>
          <button type="button">First control</button>
          <button type="button">Last control</button>
        </ReviewDialog>
      )}
    </>
  );
}

describe("ReviewDialog keyboard behavior", () => {
  it("contains Tab focus, closes on Escape and restores the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open review" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Confirm decision" });
    const first = within(dialog).getByRole("button", { name: "First control" });
    const last = within(dialog).getByRole("button", { name: "Last control" });
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("does not close a pending submission with Escape", async () => {
    const user = userEvent.setup();
    render(<Harness busy />);
    await user.click(screen.getByRole("button", { name: "Open review" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
