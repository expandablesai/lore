// Capture: pasted text becomes a markdown note, and the receipt reports what was
// indexed with its timestamps and who saved it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Capture } from "./Capture";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

const indexed = {
  id: "d1",
  orgId: "o1",
  scope: "org",
  filename: "a-note.md",
  mime: "text/markdown",
  sizeBytes: 42,
  sha256: "abc",
  storageKey: "abc.md",
  status: "indexed",
  pageCount: null,
  error: null,
  createdAt: "2026-10-31T14:00:00.000Z",
  extractedAt: "2026-10-31T14:00:04.000Z",
  uploadedByName: "Ada",
  chunkCount: 2,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Capture", () => {
  it("saves pasted text as a note and reports the receipt", async () => {
    const fetchMock = installFetchMock({
      "/api/documents/upload": jsonResponse(202, { id: "d1", status: "queued" }),
      "/api/documents/d1": jsonResponse(200, { document: indexed, chunks: [] }),
    });
    render(<Capture token="t" user={user} navigate={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Paste text"), "Launch notes for episode three");
    await userEvent.click(screen.getByRole("button", { name: "Save & index" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Saved" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("indexed")).toBeInTheDocument());

    const upload = fetchMock.mock.calls.find((c) => String(c[0]).includes("/documents/upload"));
    const form = (upload?.[1] as RequestInit).body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toMatch(/^launch-notes-for-episode-three-.*\.md$/);
    expect(file.type).toBe("text/markdown");

    // The receipt carries the metadata the request asked for.
    expect(screen.getByText(/text\/markdown/)).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Indexed")).toBeInTheDocument();
    expect(screen.getAllByText("Saved").length).toBeGreaterThanOrEqual(1);
  });

  it("sends pasted text on Enter", async () => {
    const fetchMock = installFetchMock({
      "/api/documents/upload": jsonResponse(202, { id: "d1", status: "queued" }),
      "/api/documents/d1": jsonResponse(200, { document: indexed, chunks: [] }),
    });
    render(<Capture token="t" user={user} navigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Paste text"), "quick note{Enter}");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/documents/upload"))).toBe(true),
    );
  });
});