// Profile: the picture uploads, and appearance controls write through.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profile } from "./Profile";
import { ThemeProvider } from "../lib/theme";
import type { AuthUser, MeUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };
const me: MeUser = { ...user, status: "active", theme: "dark", neon: false, hasAvatar: false };

// The profile reads the signed-in profile from AuthProvider; stub the hook.
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user,
    me,
    token: "t",
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    refreshMe: vi.fn(async () => {}),
    logout: vi.fn(),
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Profile", () => {
  it("uploads a new picture", async () => {
    const fetchMock = installFetchMock({
      "/api/me/avatar": jsonResponse(201, { hasAvatar: true }),
      "/api/me": jsonResponse(200, { ...me, hasAvatar: true }),
    });
    render(
      <ThemeProvider token="t">
        <Profile token="t" user={user} navigate={vi.fn()} />
      </ThemeProvider>,
    );

    const file = new File(["png"], "me.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Profile picture"), file);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/me/avatar"))).toBe(true),
    );
  });

  it("switches the theme from the appearance panel", async () => {
    installFetchMock({
      "/api/me": jsonResponse(200, { ...me }),
    });
    render(
      <ThemeProvider token="t">
        <Profile token="t" user={user} navigate={vi.fn()} />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
describe("Profile — password", () => {
  const renderProfile = () =>
    render(
      <ThemeProvider token="t">
        <Profile token="t" user={user} navigate={vi.fn()} />
      </ThemeProvider>,
    );

  it("changes the password and reports the ejected sessions", async () => {
    const fetchMock = installFetchMock({
      "/api/me": jsonResponse(200, { ...me }),
      "/api/me/password": jsonResponse(200, { ok: true, revokedSessions: 2 }),
    });
    renderProfile();

    await userEvent.type(screen.getByLabelText("Current password"), "old-password-1");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(screen.getByText(/Other sessions were signed out/)).toBeInTheDocument(),
    );
    const passwordCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/me/password"));
    const body = JSON.parse(String((passwordCall?.[1] as RequestInit).body)) as {
      currentPassword: string;
      newPassword: string;
    };
    expect(body).toEqual({ currentPassword: "old-password-1", newPassword: "brand-new-password" });
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("refuses mismatched confirmation without calling the API", async () => {
    const fetchMock = installFetchMock({ "/api/me": jsonResponse(200, { ...me }) });
    renderProfile();

    await userEvent.type(screen.getByLabelText("Current password"), "old-password-1");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "something-else");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/me/password"))).toBe(false);
  });

  it("says the current password is wrong in the interface language", async () => {
    installFetchMock({
      "/api/me": jsonResponse(200, { ...me }),
      "/api/me/password": jsonResponse(403, { error: "current password is incorrect" }),
    });
    renderProfile();

    await userEvent.type(screen.getByLabelText("Current password"), "wrong-password");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect.");
  });
});