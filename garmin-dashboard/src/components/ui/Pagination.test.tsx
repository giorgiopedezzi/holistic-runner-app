import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Pagination } from "./Pagination";

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => undefined;
  window.HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubPhoneWidth(isPhone: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: isPhone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("Pagination phone-width compaction (HRA-290)", () => {
  it("renders the full first/prev/jump/next/last control set at desktop width", () => {
    stubPhoneWidth(false);
    render(
      <Pagination page={2} totalPages={9} onPageChange={() => {}} perPage={25} perPageOptions={[10, 25, 50]} onPerPageChange={() => {}} totalItems={216} />,
    );
    expect(screen.getByText("«")).toBeInTheDocument();
    expect(screen.getByText("»")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument(); // jump-to-page input
  });

  it("collapses to prev/next + a plain result-position label at phone width", () => {
    stubPhoneWidth(true);
    render(
      <Pagination page={2} totalPages={9} onPageChange={() => {}} perPage={25} perPageOptions={[10, 25, 50]} onPerPageChange={() => {}} totalItems={216} />,
    );
    expect(screen.queryByText("«")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("26–50 of 216")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("disables Previous on page 1 and Next on the last page, and fires onPageChange", () => {
    stubPhoneWidth(true);
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Pagination page={1} totalPages={3} onPageChange={onPageChange} perPage={25} perPageOptions={[10, 25, 50]} onPerPageChange={() => {}} totalItems={60} />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <Pagination page={3} totalPages={3} onPageChange={onPageChange} perPage={25} perPageOptions={[10, 25, 50]} onPerPageChange={() => {}} totalItems={60} />,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows a zero-result count without a bogus 1-0 range", () => {
    stubPhoneWidth(true);
    render(
      <Pagination page={1} totalPages={1} onPageChange={() => {}} perPage={25} perPageOptions={[10, 25, 50]} onPerPageChange={() => {}} totalItems={0} />,
    );
    expect(screen.getByText("· 0 total")).toBeInTheDocument();
  });

  it("shows a correct 1-of-1 range for a single result", () => {
    stubPhoneWidth(true);
    render(
      <Pagination page={1} totalPages={1} onPageChange={() => {}} perPage={25} perPageOptions={[10, 25, 50]} onPerPageChange={() => {}} totalItems={1} />,
    );
    expect(screen.getByText("1–1 of 1")).toBeInTheDocument();
  });
});
