import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Documents } from "./Documents";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Documents", () => {
  it("lists the document library", async () => {
    installFetchMock({
      "/api/documents": jsonResponse(200, {
        documents: [
          { id: "d1", filename: "notes.txt", mime: "text/plain", sizeBytes: 12, status: "indexed", pageCount: 1, error: null, createdAt: "now" },
        ],
      }),
    });
    render(<Documents token="t" user={user} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());
  });

  it("shows why a document failed to index", async () => {
    installFetchMock({
      "/api/documents": jsonResponse(200, {
        documents: [
          { id: "d2", filename: "script.docx", mime: "application/msword", sizeBytes: 99, status: "failed", pageCount: null, error: "ENOENT: no such file or directory", createdAt: "now" },
        ],
      }),
    });
    render(<Documents token="t" user={user} navigate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("ENOENT: no such file or directory")).toBeInTheDocument(),
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("uploads a file and navigates to its detail page", async () => {
    const navigate = vi.fn();
    installFetchMock({
      "/api/documents": jsonResponse(200, { documents: [] }),
      "/api/documents/upload": jsonResponse(202, { id: "d9", status: "queued" }),
    });
    render(<Documents token="t" user={user} navigate={navigate} />);
    const file = new File(["hi"], "spec.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("File"), file);
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/documents/d9"));
  });
});
