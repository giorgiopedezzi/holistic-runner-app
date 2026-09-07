/**
 * useUnsavedGuard.test.tsx (HRA-281 AC2)
 * The cross-cutting guard App.tsx uses to block an in-app navigation or
 * language switch while the race-plan instance editor has unsaved work —
 * exercised against a tiny consumer component so the test targets the
 * hook's own contract, not any real editor's markup.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { UnsavedGuardProvider, useUnsavedGuard } from "./useUnsavedGuard";

function Consumer({ dirty, onNavigate }: { dirty: boolean; onNavigate: () => void }) {
  const { setGuard, guardedAction } = useUnsavedGuard();
  useEffect(() => {
    setGuard(() => dirty);
    return () => setGuard(null);
  }, [dirty, setGuard]);
  return <button onClick={() => guardedAction(onNavigate)}>Navigate</button>;
}

function Harness({ initialDirty }: { initialDirty: boolean }) {
  const [dirty, setDirty] = useState(initialDirty);
  const [navigated, setNavigated] = useState(false);
  return (
    <UnsavedGuardProvider>
      <Consumer dirty={dirty} onNavigate={() => setNavigated(true)} />
      <button onClick={() => setDirty(false)}>Mark clean</button>
      <div>{navigated ? "navigated" : "not navigated"}</div>
    </UnsavedGuardProvider>
  );
}

describe("useUnsavedGuard", () => {
  it("runs the action immediately when nothing is dirty", () => {
    render(<Harness initialDirty={false} />);
    fireEvent.click(screen.getByText("Navigate"));
    expect(screen.getByText("navigated")).toBeInTheDocument();
  });

  it("blocks with a confirm dialog when dirty, and only navigates on confirm", () => {
    render(<Harness initialDirty />);
    fireEvent.click(screen.getByText("Navigate"));
    expect(screen.getByText("not navigated")).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes. Leave and discard them?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Discard and leave"));
    expect(screen.getByText("navigated")).toBeInTheDocument();
  });

  it("cancel dismisses the dialog without running the action", () => {
    render(<Harness initialDirty />);
    fireEvent.click(screen.getByText("Navigate"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("not navigated")).toBeInTheDocument();
    expect(screen.queryByText("You have unsaved changes. Leave and discard them?")).not.toBeInTheDocument();
  });

  it("useUnsavedGuard works with no provider mounted (no-op default)", () => {
    const onNavigate = vi.fn();
    function Standalone() {
      const { guardedAction } = useUnsavedGuard();
      return <button onClick={() => guardedAction(onNavigate)}>Go</button>;
    }
    render(<Standalone />);
    fireEvent.click(screen.getByText("Go"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
