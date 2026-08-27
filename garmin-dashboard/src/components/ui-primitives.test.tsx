import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  AccordionCard,
  Badge,
  Card,
  Checkbox,
  ConfirmModal,
  ProgressBar,
  Select,
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
});
