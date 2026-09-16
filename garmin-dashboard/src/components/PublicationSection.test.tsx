import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublicationSection } from "./PublicationSection";
import { installFetch, problem } from "@/test/api-stub";

const STATUS_URL = "/api/v1/publication";

function status(overrides: Partial<{ state: string; publicUrl: string | null; projectedAt: string | null; lastError: string | null; canRetry: boolean }> = {}) {
  return { state: "unconfigured", publicUrl: null, projectedAt: null, lastError: null, canRetry: false, ...overrides };
}

async function expandCard() {
  fireEvent.click(await screen.findByRole("button", { name: /Public journey/ }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PublicationSection", () => {
  it("renders nothing for a caller without the founder publication entitlement (403)", async () => {
    installFetch({ [`GET ${STATUS_URL}`]: problem(403, "Forbidden") });
    const { container } = render(<PublicationSection />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows the current lifecycle state, freshness, and public URL", async () => {
    installFetch({
      [`GET ${STATUS_URL}`]: status({ state: "published", publicUrl: "/p/founder-journey", projectedAt: "2026-09-15T12:30:00.000Z" }),
    });
    render(<PublicationSection />);
    await expandCard();

    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.getByText("/p/founder-journey")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suspend" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("previews as Guest using the same projected-data rendering Guests see, before first publication", async () => {
    installFetch({
      [`GET ${STATUS_URL}`]: status(),
      [`GET ${STATUS_URL}/preview`]: {
        ...status({ state: "draft" }),
        sourceVersion: "abc123",
        snapshot: {
          schemaVersion: 1, slug: "founder-journey", sourceVersion: "abc123", projectedAt: "2026-09-16T08:00:00.000Z",
          profile: { publicId: "p1", fields: { displayName: "Giorgio" } },
          activities: [{ publicId: "a1", fields: { title: "Long run", date: "2026-09-15", distanceM: 21000 } }],
          plans: [], reports: [],
        },
      },
    });
    render(<PublicationSection />);
    await expandCard();
    fireEvent.click(await screen.findByRole("button", { name: "Preview as Guest" }));

    expect(await screen.findByRole("heading", { name: "Giorgio's road to the start line" })).toBeInTheDocument();
    expect(screen.getByText("Long run")).toBeInTheDocument();
  });

  it("requires confirmation before publishing, then reflects the server-confirmed state", async () => {
    installFetch({
      [`GET ${STATUS_URL}`]: status(),
      [`POST ${STATUS_URL}/publish`]: status({ state: "published", publicUrl: "/p/founder-journey", projectedAt: "2026-09-16T08:00:00.000Z" }),
    });
    render(<PublicationSection />);
    await expandCard();

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/anonymously accessible/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires confirmation before suspending, and offers Retry instead of Refresh after a failed refresh", async () => {
    installFetch({
      [`GET ${STATUS_URL}`]: status({ state: "published", publicUrl: "/p/founder-journey", projectedAt: "2026-09-15T00:00:00.000Z", lastError: "projection_refresh_failed", canRetry: true }),
      [`POST ${STATUS_URL}/suspend`]: status({ state: "suspended" }),
    });
    render(<PublicationSection />);
    await expandCard();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh published data" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));

    expect(await screen.findByText("Suspended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
  });
});
