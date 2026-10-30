import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Memory } from "./Memory";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

const sky = {
  id: "a1",
  scope: "org",
  subject: "sky",
  predicate: "is",
  object: "blue",
  status: "confirmed",
  trust: 2,
  confidence: 0.9,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Memory", () => {
  it("recalls assertions for a query", async () => {
    installFetchMock({ "/api/recall": jsonResponse(200, [sky]) });
    render(<Memory token="t" user={user} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Query"), "sky");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText(/blue/)).toBeInTheDocument());
    expect(screen.getByText("is")).toBeInTheDocument();
  });

  it("writes a remember triple and clears the form", async () => {
    installFetchMock({ "/api/remember": jsonResponse(200, { id: "a2", scope: "org", subject: "grass", status: "proposed" }) });
    render(<Memory token="t" user={user} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Subject"), "grass");
    await userEvent.type(screen.getByLabelText("Predicate"), "is");
    await userEvent.type(screen.getByLabelText("Object"), "green");
    await userEvent.click(screen.getByRole("button", { name: "Remember" }));
    await waitFor(() => expect(screen.getByLabelText("Subject")).toHaveValue(""));
  });

  it("forgets an assertion from the recall results", async () => {
    installFetchMock({
      "/api/recall": jsonResponse(200, [sky]),
      "/api/forget": jsonResponse(200, { forgotten: "a1", receipt: { by: "u1", reason: null, at: "now", cascadedDocIds: [] } }),
    });
    render(<Memory token="t" user={user} navigate={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Forget" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Forget" })).not.toBeInTheDocument());
  });
});
