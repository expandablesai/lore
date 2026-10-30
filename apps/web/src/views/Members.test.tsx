import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Members } from "./Members";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const admin: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };
const viewer: AuthUser = { id: "u2", orgId: "o1", email: "v@b.c", displayName: "Vic", role: "viewer" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Members", () => {
  it("lists the organization's users", async () => {
    installFetchMock({
      "/api/orgs/o1/users": jsonResponse(200, [
        { id: "u1", email: "a@b.c", displayName: "Ada", role: "org_admin", status: "active" },
      ]),
    });
    render(<Members token="t" user={admin} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
  });

  it("adds a member when the caller can manage the org", async () => {
    installFetchMock({
      "/api/orgs/o1/users": (url, init) =>
        init?.method === "POST"
          ? jsonResponse(201, { id: "u3", email: "n@b.c", role: "member" })
          : jsonResponse(200, []),
    });
    render(<Members token="t" user={admin} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Display name"), "Nia");
    await userEvent.type(screen.getByLabelText("Email"), "n@b.c");
    await userEvent.type(screen.getByLabelText("Temporary password"), "pw12345");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue(""));
  });

  it("hides the add-member form from a viewer", async () => {
    installFetchMock({ "/api/orgs/o1/users": jsonResponse(200, []) });
    render(<Members token="t" user={viewer} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("No members yet.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
  });
});
