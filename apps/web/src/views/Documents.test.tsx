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
    await userEvent.upload(screen.getByLabelText("Files"), file);
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/documents/d9"));
  });

  it("uploads several files of mixed types in one go and reports each", async () => {
    const navigate = vi.fn();
    const fetchMock = installFetchMock({
      "/api/documents": jsonResponse(200, { documents: [] }),
      "/api/documents/upload": jsonResponse(202, { id: "d1", status: "queued" }),
    });
    render(<Documents token="t" user={user} navigate={navigate} />);

    const spec = new File(["script"], "script.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const picture = new File(["png"], "portfolio.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Files"), [spec, picture]);
    await userEvent.click(screen.getByRole("button", { name: "Upload 2 files" }));

    await waitFor(() => expect(screen.getAllByText("sent")).toHaveLength(2));
    const uploads = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/documents/upload"),
    );
    expect(uploads).toHaveLength(2);
    // A batch stays on the list; jumping to one detail page would hide the rest.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps going when one file in the batch is rejected", async () => {
    let call = 0;
    installFetchMock({
      "/api/documents": jsonResponse(200, { documents: [] }),
      "/api/documents/upload": () => {
        call += 1;
        return call === 1
          ? jsonResponse(202, { id: "d1", status: "queued" })
          : jsonResponse(415, { error: "image ingestion needs a vision model" }, false);
      },
    });
    render(<Documents token="t" user={user} navigate={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Files"), [
      new File(["a"], "ok.txt", { type: "text/plain" }),
      new File(["b"], "bad.png", { type: "image/png" }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Upload 2 files" }));

    await waitFor(() => expect(screen.getByText("failed")).toBeInTheDocument());
    expect(screen.getByText(/vision model/)).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
  });
});
