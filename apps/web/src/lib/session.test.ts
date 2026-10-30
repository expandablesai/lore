import { beforeEach, describe, expect, it } from "vitest";
import { clearToken, loadToken, saveToken } from "./session";

describe("session token storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no token is stored", () => {
    expect(loadToken()).toBeNull();
  });

  it("round-trips a saved token", () => {
    saveToken("abc123");
    expect(loadToken()).toBe("abc123");
  });

  it("clears the stored token", () => {
    saveToken("abc123");
    clearToken();
    expect(loadToken()).toBeNull();
  });
});
