// Sidebar destinations: Paste is not one of them — it is the top of Memory, and
// an old #/capture link has to land there rather than on a dead route.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NAV, routeFor, Shell } from "./Shell";
import { installFetchMock, jsonResponse } from "./test/fetchMock";
import { I18nProvider } from "./lib/i18n";
import { NavProvider } from "./lib/nav";
import { ThemeProvider } from "./lib/theme";

// The shell reads the signed-in user from AuthProvider; stub the hook.
vi.mock("./lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" },
    me: {
      id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin",
      status: "active", theme: "dark", neon: false, hasAvatar: false, locale: null,
    },
    token: "t",
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    refreshMe: vi.fn(async () => {}),
    logout: vi.fn(),
  }),
}));

describe("Shell navigation", () => {
  it("does not offer Paste as its own destination", () => {
    expect(NAV.map((item) => item.label)).not.toContain("Paste");
    expect(NAV.map((item) => item.path)).not.toContain("/capture");
  });

  it("keeps Memory in the sidebar", () => {
    expect(NAV.map((item) => item.label)).toContain("Memory");
  });

  it("resolves a legacy #/capture link to Memory", () => {
    expect(routeFor("/capture")).toBe("/memory");
    expect(routeFor("/memory")).toBe("/memory");
    expect(routeFor("/chat/abc")).toBe("/chat/abc");
  });
});

// The shell must own the viewport: a long conversation (or a long list of recent
// chats) used to grow the page, which scrolled the chat header away.
describe("Shell layout", () => {
  function renderShell() {
    window.location.hash = "#/chat";
    return render(
      <NavProvider>
        <I18nProvider>
          <ThemeProvider token="t">
            <Shell />
          </ThemeProvider>
        </I18nProvider>
      </NavProvider>,
    );
  }

  it("pins the console to the viewport and scrolls only the content", () => {
    installFetchMock({
      "/api/me": jsonResponse(200, {
        id: "u1", email: "a@b.c", displayName: "Ada", role: "org_admin", orgId: "o1",
        status: "active", theme: "dark", neon: false, hasAvatar: false, locale: null,
      }),
      "/api/chats": jsonResponse(200, []),
    });
    const { container } = renderShell();

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-hidden");
    expect(root.className).toContain("h-screen");
    const main = root.querySelector("main");
    expect(main?.className).toContain("min-h-0");
    expect(main?.querySelector(".overflow-y-auto")).not.toBeNull();
  });

  it("keeps the chat header out of the scrolling transcript", () => {
    installFetchMock({
      "/api/me": jsonResponse(200, {
        id: "u1", email: "a@b.c", displayName: "Ada", role: "org_admin", orgId: "o1",
        status: "active", theme: "dark", neon: false, hasAvatar: false, locale: null,
      }),
      "/api/chats": jsonResponse(200, []),
    });
    renderShell();

    const heading = screen.getByRole("heading", { name: "Chat" });
    const empty = screen.getByText("Ask anything about your workspace");
    const transcript = empty.closest(".overflow-y-auto");
    expect(transcript).not.toBeNull();
    expect(transcript?.contains(heading)).toBe(false);
  });
});