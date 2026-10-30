import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DocumentDetail } from "./DocumentDetail";
import type { AuthUser } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DocumentDetail", () => {
  it("shows metadata and extracted chunks", async () => {
    installFetchMock({
      "/api/documents/d1": jsonResponse(200, {
        document: {
          id: "d1",
          orgId: "o1",
          scope: "org",
          filename: "report.pdf",
          mime: "application/pdf",
          sizeBytes: 2048,
          sha256: "abc123",
          storageKey: "sha256:abc123",
          status: "indexed",
          pageCount: 3,
          error: null,
        },
        chunks: [{ id: "c1", seq: 1, text: "hello world", tokens: 2, pageFrom: 1, pageTo: 1 }],
      }),
    });
    render(<DocumentDetail token="t" user={user} navigate={vi.fn()} id="d1" />);
    await waitFor(() => expect(screen.getByText("report.pdf")).toBeInTheDocument());
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.getByText(/Chunks \(1\)/)).toBeInTheDocument();
  });
});
