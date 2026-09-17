import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UploadSection } from "./UploadSection";
import { installFetch, json, problem } from "@/test/api-stub";

afterEach(() => vi.unstubAllGlobals());

function routes(importResponse: Response) {
  return {
    "GET /api/v1/garmin/status": { connected: false, reason: "device_not_found" },
    "POST /api/v1/imports/fit-zip": importResponse,
  };
}

describe("UploadSection FIT ZIP import", () => {
  it("shows the ordered per-file partial-success result", async () => {
    installFetch(routes(json({
      results: [
        { filename: "duplicate.fit", status: "duplicate", reason: "Already imported." },
        { filename: "valid.fit", status: "imported" },
        { filename: "broken.fit", status: "failed", reason: "Invalid FIT header." },
      ],
      summary: { imported: 1, duplicates: 1, failed: 1 },
    })));
    render(<UploadSection />);

    fireEvent.change(screen.getByLabelText("Choose a FIT ZIP archive"), {
      target: { files: [new File(["zip"], "activities.zip", { type: "application/zip" })] },
    });

    await waitFor(() => expect(screen.getByText("1 imported, 1 duplicates, 1 failed.")).toBeInTheDocument());
    expect(screen.getByText("duplicate.fit")).toBeInTheDocument();
    expect(screen.getByText("valid.fit")).toBeInTheDocument();
    expect(screen.getByText("broken.fit")).toBeInTheDocument();
    expect(screen.getByText("Invalid FIT header.")).toBeInTheDocument();
  });

  it("surfaces archive-level validation without rendering stale results", async () => {
    installFetch(routes(problem(422, "The ZIP contains more than 14 FIT files.")));
    render(<UploadSection />);

    fireEvent.change(screen.getByLabelText("Choose a FIT ZIP archive"), {
      target: { files: [new File(["zip"], "too-many.zip", { type: "application/zip" })] },
    });

    await waitFor(() => expect(screen.getByText("The ZIP contains more than 14 FIT files.")).toBeInTheDocument());
    expect(screen.queryByLabelText("FIT import results")).not.toBeInTheDocument();
  });
});
