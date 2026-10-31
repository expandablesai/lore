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