// The provider keys screen: a key can be switched off without being revoked, so
// the provider in use is a choice rather than a deletion.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LlmKeys } from "./LlmKeys";
import type { AuthUser, OrgLlmKey } from "../lib/types";
import { installFetchMock, jsonResponse } from "../test/fetchMock";

const user: AuthUser = { id: "u1", orgId: "o1", email: "a@b.c", displayName: "Ada", role: "org_admin" };

function key(overrides: Partial<OrgLlmKey> = {}): OrgLlmKey {
  return {
    id: "k1",
    label: "Mac Strata",
    provider: "strata",
    apiType: "openai",
    baseUrl: "http://10.20.10.81:8080/v1",
    chatModel: "qwen3.8-flash",
    embedModel: "",
    embedDim: 3072,
    visionModel: null,
    enabled: true,
    createdAt: "now",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LlmKeys", () => {
  it("toggles a key off and shows it as disabled", async () => {
    const fetchMock = installFetchMock({
      "/api/orgs/o1/llm-keys": jsonResponse(200, [key()]),
    });
    render(<LlmKeys token="t" user={user} navigate={vi.fn()} />);

    const toggle = await screen.findByRole("switch", { name: "Disable Mac Strata" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByText("disabled")).toBeInTheDocument());
    const patch = fetchMock.mock.calls.at(-1);
    expect(String(patch?.[0])).toBe("/api/orgs/o1/llm-keys/k1");
    expect((patch?.[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ enabled: false });
  });

  it("renders a disabled key dimmed, still testable", async () => {
    installFetchMock({
      "/api/orgs/o1/llm-keys": jsonResponse(200, [key({ enabled: false })]),
    });
    render(<LlmKeys token="t" user={user} navigate={vi.fn()} />);

    expect(await screen.findByText("disabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable Mac Strata" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // A switched-off key keeps its configuration, so it can still be tested.
    expect(screen.getByRole("button", { name: "Test" })).toBeInTheDocument();
  });
});