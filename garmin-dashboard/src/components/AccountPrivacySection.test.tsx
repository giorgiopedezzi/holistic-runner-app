/**
 * AccountPrivacySection.test.tsx  (HRA-385)
 * AC5/AC6: the timezone field is a selection of valid canonical IANA
 * identifiers, not free text — AC7: a saved display-name change reflects in
 * the sidebar's own identity chrome (AuthGate's DisplayNameContext) without
 * requiring a reload. Rendered inside a real AuthGate so both effects
 * (AuthGate's own session bootstrap and AccountPrivacySection's own profile
 * load) are exercised together, same as the real app.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountPrivacySection } from "./AccountPrivacySection";
import { AuthGate, useDisplayName } from "./AuthGate";
import { api } from "@/api/client";

const session = (overrides: Partial<{ display_name: string | null; timezone: string | null }> = {}) => ({
  user: {
    id: "founder", locale: "en", unit_system: "metric" as const, role: "admin" as const,
    display_name: "Giorgio", timezone: "Europe/Rome",
    ...overrides,
  },
  entitlements: [], csrfToken: "test-csrf",
});

function DisplayNameProbe() {
  const [displayName] = useDisplayName();
  return <span>sidebarDisplayName:{displayName ?? "none"}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountPrivacySection", () => {
  it("renders the stored timezone as a selected canonical IANA option, not free text", async () => {
    vi.spyOn(api.auth, "session").mockResolvedValue(session());
    render(<AuthGate><AccountPrivacySection /></AuthGate>);

    fireEvent.click(await screen.findByRole("button", { name: "Account & privacy" }));

    const trigger = await screen.findByRole("combobox", { name: "Timezone" });
    expect(trigger).toHaveTextContent("Europe/Rome");
    // AC5: no free-text input left for timezone.
    expect(screen.queryByRole("textbox", { name: "Timezone" })).not.toBeInTheDocument();
  });

  it("saving a profile change updates the sidebar's own display-name context (AC7), no decorative welcome copy needed", async () => {
    vi.spyOn(api.auth, "session").mockResolvedValue(session({ display_name: "Giorgio" }));
    vi.spyOn(api.account, "updateProfile").mockResolvedValue({
      display_name: "New Name", locale: "en", unit_system: "metric", timezone: "Europe/Rome",
    });

    render(<AuthGate><DisplayNameProbe /><AccountPrivacySection /></AuthGate>);

    expect(await screen.findByText("sidebarDisplayName:Giorgio")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Account & privacy" }));
    const nameInput = await screen.findByDisplayValue("Giorgio");
    fireEvent.change(nameInput, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(screen.getByText("sidebarDisplayName:New Name")).toBeInTheDocument());
    expect(api.account.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ display_name: "New Name" }));
  });
});
