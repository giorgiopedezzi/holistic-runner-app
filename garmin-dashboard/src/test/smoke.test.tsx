/**
 * src/test/smoke.test.tsx  (HRA-62)
 * Proves the frontend harness works end to end: Vitest runs .tsx under jsdom,
 * the `@/` alias resolves, React renders, and jest-dom matchers are registered.
 * Real component/unit coverage lands in T5 (HRA-63).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, Empty } from "@/components/ui";

describe("frontend test harness", () => {
  it("renders a ui primitive via the @/ alias", () => {
    render(<Badge label="running" color="var(--accent-green)" />);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders the Empty state with its default message", () => {
    render(<Empty />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
