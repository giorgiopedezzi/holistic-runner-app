import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  AccordionCard,
  Badge,
  Card,
  Checkbox,
  ConfirmModal,
  HelpDisclosure,
  ProgressBar,
  Select,
  Sheet,
  SheetContent,
  SheetTrigger,
} from "./ui";

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => undefined;
  window.HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
});

describe("shared UI primitive contracts", () => {
  it("keeps Card composition and tooltip contracts class-based", () => {
    render(<Card className="mb-4" tooltip="Comparison details">Body</Card>);
    const card = screen.getByText("Body");
    expect(card).toHaveClass("card", "mb-4", "hra-tooltip");
    expect(card).toHaveAttribute("data-tooltip", "Comparison details");
    expect(card).not.toHaveAttribute("style");
  });

  it("exposes accordion state and preserves caller-owned toggling", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <AccordionCard title="Details" expanded={false} onToggle={onToggle}>Panel</AccordionCard>,
    );
    const trigger = screen.getByRole("button", { name: "Details" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Panel")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<AccordionCard title="Details" expanded onToggle={onToggle}>Panel</AccordionCard>);
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Panel")).toBeInTheDocument();
  });

  it("keeps checkbox state, disabled behavior, and runtime hooks intact", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Checkbox checked={false} onCheckedChange={onCheckedChange} color="#123456" size={18} />,
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveStyle({ "--checkbox-color": "#123456", "--checkbox-size": "18px" });
    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    rerender(<Checkbox checked={false} onCheckedChange={onCheckedChange} disabled />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("portals Select options and preserves disabled/runtime-dimension contracts", () => {
    const onValueChange = vi.fn();
    const { container, rerender } = render(
      <Select
        value="a"
        onValueChange={onValueChange}
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]}
        triggerWidth={180}
        triggerHeight={32}
      />,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveStyle({ "--select-trigger-width": "180px", "--select-trigger-height": "32px" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: "Beta" });
    expect(option).toBeInTheDocument();
    expect(container).not.toContainElement(option);
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith("b");

    rerender(
      <Select value="a" onValueChange={onValueChange} options={[{ value: "a", label: "Alpha" }]} disabled />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("focuses modal cancellation and keeps dialog/backdrop actions distinct", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open
        title={<h2>Delete item?</h2>}
        confirmLabel="Delete"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    fireEvent.click(dialog);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("uses runtime variables without mixing static declarations", () => {
    const { container } = render(
      <>
        <Badge label="Running" color="#abcdef" />
        <ProgressBar label="Sync" current={1} total={4} accent="#fedcba" />
      </>,
    );
    expect(screen.getByText("Running")).toHaveStyle({ "--badge-color": "#abcdef" });
    const bar = container.querySelector(".hra-progress-bar");
    expect(bar).toHaveStyle({ "--progress-color": "#fedcba", "--progress-width": "25%" });
  });

  it("HelpDisclosure: opens via click, closes on Escape or an outside tap, and returns focus to the trigger", async () => {
    render(
      <>
        <HelpDisclosure label="Help with pace zones" heading="Pace zones">
          Zones are derived from your recent race pace.
        </HelpDisclosure>
        <button>Outside</button>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Help with pace zones" });
    expect(trigger).toHaveClass("hra-help-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Pace zones")).not.toBeInTheDocument();

    // Open via click.
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Pace zones")).toBeInTheDocument();
    expect(screen.getByText(/derived from your recent race pace/)).toBeInTheDocument();

    // Close via Escape — focus returns to the trigger. Radix's focus-return
    // fires from a MutationObserver microtask on unmount, not synchronously
    // within the keydown handler, so the assertion needs a tick.
    fireEvent.keyDown(screen.getByText("Pace zones"), { key: "Escape" });
    expect(screen.queryByText("Pace zones")).not.toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(trigger).toHaveFocus();

    // Reopen, then close via an outside tap — Radix defers this dismissal to
    // the next real "click" after the pointerdown, and only attaches its
    // outside-pointerdown listener on the next tick after mount.
    fireEvent.click(trigger);
    expect(screen.getByText("Pace zones")).toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    expect(screen.queryByText("Pace zones")).not.toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(trigger).toHaveFocus();
  });

  it("Sheet: opens via trigger, traps focus, closes on Escape or the backdrop, and restores focus to the trigger (HRA-290)", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetContent title="Filters">
          <button>Inside field</button>
        </SheetContent>
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Open filters" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("hra-sheet-content");
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inside field" })).toBeInTheDocument();

    // Escape closes and returns focus to the trigger (Radix's default modal
    // Dialog behavior — the whole point of building this on
    // @radix-ui/react-dialog instead of hand-rolling it).
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(trigger).toHaveFocus();

    // Reopen, then dismiss via the backdrop (Overlay) itself.
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const overlay = document.querySelector(".hra-sheet-overlay")!;
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(trigger).toHaveFocus();
  });

  it("Sheet: close button carries an accessible name and closes the dialog", () => {
    render(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetContent title="Filters">
          <span>Body</span>
        </SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
