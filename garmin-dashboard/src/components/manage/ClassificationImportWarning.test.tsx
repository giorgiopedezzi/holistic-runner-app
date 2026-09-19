import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ClassificationImportWarning } from "./ClassificationImportWarning";
import { installFetch } from "@/test/api-stub";
import { settings } from "@/test/fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("ClassificationImportWarning", () => {
  it("warns before import when Free Training parameters are incomplete (HRA-395)", async () => {
    installFetch({ "GET /api/v1/settings": settings({
      current_easy_pace_sec_per_km: null,
      current_race_pace_sec_per_km: 300,
      current_long_run_target_m: 15000,
    }) });
    render(<ClassificationImportWarning />);

    expect(await screen.findByText(/Current easy pace/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "?tab=settings");
  });

  it("is absent once every Free Training parameter is configured", async () => {
    const fetchMock = installFetch({ "GET /api/v1/settings": settings({
      current_easy_pace_sec_per_km: 330,
      current_race_pace_sec_per_km: 270,
      current_long_run_target_m: 18000,
    }) });
    render(<ClassificationImportWarning />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings"), expect.anything()));
    expect(screen.queryByRole("link", { name: "Open Settings" })).not.toBeInTheDocument();
  });
});
