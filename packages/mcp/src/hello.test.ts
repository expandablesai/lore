import { describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP Hello-World Test — proves tools/list works (M0 gate)
 */

describe("MCP server", () => {
  test("tools/list returns memory tool definitions", async () => {
    const server = new McpServer({ name: "dsh", version: "0.0.0" });

    // Register placeholder tools matching the frozen surface
    server.tool("memory_recall", "Retrieve compiled memory block", {}, async () => ({ content: [{ type: "text", text: "[]" }] }));
    server.tool("memory_remember", "Store assertions", {}, async () => ({ content: [{ type: "text", text: "[]" }] }));
    server.tool("memory_confirm", "Confirm proposed assertions", {}, async () => ({ content: [{ type: "text", text: "[]" }] }));
    server.tool("memory_forget", "Delete with receipt", {}, async () => ({ content: [{ type: "text", text: "{}" }] }));
    server.tool("memory_conflicts", "Open contradictions", {}, async () => ({ content: [{ type: "text", text: "[]" }] }));
    server.tool("memory_audit", "Provenance chain", {}, async () => ({ content: [{ type: "text", text: "{}" }] }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t: any) => t.name);

    expect(names).toContain("memory_recall");
    expect(names).toContain("memory_remember");
    expect(names).toContain("memory_confirm");
    expect(names).toContain("memory_forget");
    expect(names).toContain("memory_conflicts");
    expect(names).toContain("memory_audit");
  });
});
