import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, request } from "./api";

interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

function jsonResponse(status: number, body: unknown, ok = status < 400): MockResponse {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => (body === null ? "" : JSON.stringify(body)),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] as RequestInit };
}

describe("request", () => {
  it("roots every call at the same-origin /api base", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await request("/healthz");
    expect(lastCall().url).toBe("/api/healthz");
  });

  it("attaches a bearer authorization header when a token is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await request("/me", { token: "abc123" });
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer abc123");
  });

  it("serializes a JSON body with a content-type header", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await request("/auth/login", {
      method: "POST",
      body: { email: "a@b.c", password: "hunter2" },
    });
    const { init } = lastCall();
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(init.body).toBe('{"email":"a@b.c","password":"hunter2"}');
  });

  it("throws ApiError carrying the server error message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: "invalid session" }, false),
    );
    await expect(request("/me", { token: "x" })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "invalid session",
    });
  });

  it("falls back to status text when the body has no error field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, null, false));
    const err = await request("/orgs").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});

describe("api.login", () => {
  it("posts credentials to /api/auth/login and returns the token payload", async () => {
    const payload = {
      token: "tok",
      user: {
        id: "u1",
        orgId: "o1",
        email: "a@b.c",
        displayName: "A",
        role: "org_admin",
      },
    };
    fetchMock.mockResolvedValue(jsonResponse(200, payload));
    const result = await api.login({ email: "a@b.c", password: "hunter2" });
    expect(result).toEqual(payload);
    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
  });
});

describe("api.documents", () => {
  it("builds a paginated query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { documents: [] }));
    await api.documents("tok", { limit: 20, offset: 40 });
    expect(lastCall().url).toBe("/api/documents?limit=20&offset=40");
  });

  it("omits the query string when no params are given", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { documents: [] }));
    await api.documents("tok");
    expect(lastCall().url).toBe("/api/documents");
  });
});

describe("api.uploadDocument", () => {
  it("sends multipart form data with the file and scope", async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { id: "d1", status: "queued" }));
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await api.uploadDocument("tok", file, "personal");
    const { url, init } = lastCall();
    expect(url).toBe("/api/documents/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("scope")).toBe("personal");
    expect((form.get("file") as File).name).toBe("notes.txt");
  });
});

describe("api.recall", () => {
  it("posts the recall body and returns assertions", async () => {
    const rows = [
      {
        id: "a1",
        scope: "org",
        subject: "sky",
        predicate: "is",
        object: "blue",
        status: "confirmed",
        trust: 2,
        confidence: 0.9,
      },
    ];
    fetchMock.mockResolvedValue(jsonResponse(200, rows));
    const result = await api.recall("tok", { query: "sky", scope: "org" });
    expect(result).toEqual(rows);
    expect(lastCall().init.body).toBe('{"query":"sky","scope":"org"}');
  });
});
