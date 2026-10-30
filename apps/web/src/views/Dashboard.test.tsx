import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "./Dashboard";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dashboard", () => {
  it("greets the user and lists their organizations", async () => {
    installFetchMock({
      "/api/orgs": jsonResponse(200, [
        { id: "o1", name: "ACME", slug: "acme", mode: "standalone", settings: {}, createdAt: "now" },
      ]),
    });
    render(<Dashboard token="t" user={user} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("ACME")).toBeInTheDocument());
    expect(screen.getByText(/Welcome back, Ada/)).toBeInTheDocument();
  });

  it("surfaces an error when organizations fail to load", async () => {
    installFetchMock({ "/api/orgs": jsonResponse(500, { error: "boom" }, false) });
    render(<Dashboard token="t" user={user} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });
});
