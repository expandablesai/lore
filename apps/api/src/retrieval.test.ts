// Whole-document questions: the trigger and the budget are pure, so they can be
// pinned here without a database. The integration is exercised on the live
// inspector (a whole-document question selects the document's chunks in order).
import { describe, expect, it } from "vitest";
import { DOCUMENT_TOKEN_BUDGET, WANTS_WHOLE_DOCUMENT, fitToTokenBudget } from "./retrieval.ts";

describe("WANTS_WHOLE_DOCUMENT", () => {
  it.each([
    "tell me everything you know about EXPOFLIX",
    "summarise this document",
    "summarize the report",
    "what is in the file?",
    "give me the full overview",
    "explain the whole upload",
  ])("recognises %s", (question) => {
    expect(WANTS_WHOLE_DOCUMENT.test(question)).toBe(true);
  });

  it.each([
    "who is Li Wei's mother?",
    "what does the factory module do?",
    "who is it for?",
    "which gate sits in front of the console?",
  ])("leaves %s on the normal path", (question) => {
    expect(WANTS_WHOLE_DOCUMENT.test(question)).toBe(false);
  });
});

describe("fitToTokenBudget", () => {
  const rows = (tokens: number[]) => tokens.map((tokens, i) => ({ tokens, i }));

  it("stops before the budget is exceeded", () => {
    expect(fitToTokenBudget(rows([100, 100, 100]), 250).map((r) => r.i)).toEqual([0, 1]);
  });

  it("keeps one row even when that row alone is over budget", () => {
    expect(fitToTokenBudget(rows([500]), 100)).toHaveLength(1);
  });

  it("returns nothing for no rows", () => {
    expect(fitToTokenBudget([], 100)).toEqual([]);
  });

  it("is sized for the 256K-class gateways in use, not a small local window", () => {
    expect(DOCUMENT_TOKEN_BUDGET).toBe(24000);
  });
});
