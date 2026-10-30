import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "../lib/auth";
import { Login } from "./Login";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

function Harness() {
  const { user } = useAuth();
  return user ? <div>signed in as {user.displayName}</div> : <Login />;
}

const ada = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Login", () => {
  it("signs in with email and password", async () => {
    installFetchMock({ "/api/auth/login": jsonResponse(200, { token: "t", user: ada }) });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("signed in as Ada")).toBeInTheDocument());
  });

  it("surfaces the server error message on a rejected login", async () => {
    installFetchMock({ "/api/auth/login": jsonResponse(401, { error: "bad credentials" }, false) });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("bad credentials"));
  });

  it("switches to signup and creates an account", async () => {
    installFetchMock({ "/api/auth/signup": jsonResponse(200, { token: "t", user: ada }) });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await userEvent.type(screen.getByLabelText("Display name"), "Ada");
    await userEvent.type(screen.getByLabelText("Organization"), "ACME");
    await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByText("signed in as Ada")).toBeInTheDocument());
  });
});
