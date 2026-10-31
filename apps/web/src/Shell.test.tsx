// Sidebar destinations: Paste is not one of them — it is the top of Memory, and
// an old #/capture link has to land there rather than on a dead route.
import { describe, expect, it } from "vitest";
import { NAV, routeFor } from "./Shell";

describe("Shell navigation", () => {
  it("does not offer Paste as its own destination", () => {
    expect(NAV.map((item) => item.label)).not.toContain("Paste");
    expect(NAV.map((item) => item.path)).not.toContain("/capture");
  });

  it("keeps Memory in the sidebar", () => {
    expect(NAV.map((item) => item.label)).toContain("Memory");
  });

  it("resolves a legacy #/capture link to Memory", () => {
    expect(routeFor("/capture")).toBe("/memory");
    expect(routeFor("/memory")).toBe("/memory");
    expect(routeFor("/chat/abc")).toBe("/chat/abc");
  });
});
