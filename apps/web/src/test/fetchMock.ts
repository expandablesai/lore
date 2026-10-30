// Shared fetch-mock harness for view tests. The typed client reads
// `res.text()`, `res.ok`, `res.status`, `res.statusText`, so a Response-like
// stub is enough. Routes are matched by full URL, then pathname, then prefix.
import { vi } from "vitest";

export interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

export function jsonResponse(status: number, body: unknown, ok = status < 400): MockResponse {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => (body === null ? "" : JSON.stringify(body)),
  };
}

export type FetchRoute = MockResponse | ((url: string, init?: RequestInit) => MockResponse);

export function installFetchMock(routes: Record<string, FetchRoute>) {
  const keys = Object.keys(routes);
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<MockResponse> => {
    const url = typeof input === "string" ? input : String(input);
    const pathname = url.split("?")[0] ?? url;
    let route: FetchRoute | undefined = routes[url] ?? routes[pathname];
    if (!route) {
      const prefix = keys.find((key) => url.startsWith(key));
      if (prefix) route = routes[prefix];
    }
    if (!route) throw new Error(`installFetchMock: no route for ${url}`);
    return typeof route === "function" ? route(url, init) : route;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
