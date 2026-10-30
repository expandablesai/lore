import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./auth";
import { loadToken, saveToken } from "./session";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

function Harness() {
  const { user, loading, login, logout } = useAuth();
  if (loading) return <div>loading</div>;
  if (!user)
    return (
      <button onClick={() => void login("a@b.c", "hunter2")}>
        sign in
      </button>
    );
  return (
    <div>
      <span>signed in as {user.displayName}</span>
      <button onClick={logout}>sign out</button>
    </div>
  );
}

const ada = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("restores the session from a stored token", async () => {
    saveToken("tok");
    installFetchMock({ "/api/auth/session": jsonResponse(200, { user: ada }) });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("signed in as Ada")).toBeInTheDocument());
  });

  it("clears a token the server rejects", async () => {
    saveToken("bad");
    installFetchMock({ "/api/auth/session": jsonResponse(401, { error: "invalid session" }, false) });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("sign in")).toBeInTheDocument());
    expect(loadToken()).toBeNull();
  });

  it("persists the token on login and clears it on logout", async () => {
    installFetchMock({ "/api/auth/login": jsonResponse(200, { token: "fresh", user: ada }) });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await userEvent.click(screen.getByText("sign in"));
    await waitFor(() => expect(screen.getByText("signed in as Ada")).toBeInTheDocument());
    expect(loadToken()).toBe("fresh");

    await userEvent.click(screen.getByText("sign out"));
    await waitFor(() => expect(screen.getByText("sign in")).toBeInTheDocument());
    expect(loadToken()).toBeNull();
  });
});
