import { describe, it, expect } from "vitest";
import { extractCsv, extractPlainText, extractHtml, extractXlsx } from "./extract.ts";

describe("extractPlainText", () => {
  it("extracts text from a buffer", () => {
    const buf = Buffer.from("Hello world\n\nSecond paragraph.", "utf-8");
    const result = extractPlainText(buf);
    expect(result.text).toContain("Hello world");
    expect(result.text).toContain("Second paragraph.");
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    expect(result.pageCount).toBeNull();
  });
});

describe("extractCsv", () => {
  it("parses CSV with header-aware chunks", () => {
    const csv = "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n";
    const buf = Buffer.from(csv, "utf-8");
    const result = extractCsv(buf);
    expect(result.text).toContain("Alice");
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0]!.text).toContain("Name: Alice");
    expect(result.chunks[0]!.text).toContain("Age: 30");
  });

  it("handles quoted fields", () => {
    const csv = 'Name,Note\nAlice,"Hello, world"\nBob,"Say ""hi"""\n';
    const buf = Buffer.from(csv, "utf-8");
    const result = extractCsv(buf);
    expect(result.chunks[0]!.text).toContain("Note: Hello, world");
    expect(result.chunks[0]!.text).toContain('Note: Say "hi"');
  });

  it("splits large CSVs into multiple chunks", () => {
    const header = "col1,col2\n";
    const rows = Array.from({ length: 1500 }, (_, i) => `r${i},v${i}`).join("\n");
    const buf = Buffer.from(header + rows, "utf-8");
    const result = extractCsv(buf);
    expect(result.chunks.length).toBe(3); // 1500 / 500 = 3
  });
});

describe("extractHtml", () => {
  it("strips tags and decodes entities", () => {
    const html = "<html><body><p>Hello &amp; welcome</p><script>evil()</script></body></html>";
    const buf = Buffer.from(html, "utf-8");
    const result = extractHtml(buf);
    expect(result.text).toContain("Hello & welcome");
    expect(result.text).not.toContain("evil");
    expect(result.text).not.toContain("<p>");
  });
});

describe("extractXlsx", () => {
  it("extracts sheets with header-aware chunks", async () => {
    // Create a small XLSX in memory using exceljs
    const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("TestSheet");
    ws.addRow(["Product", "Price", "Qty"]);
    ws.addRow(["Widget", "9.99", "100"]);
    ws.addRow(["Gadget", "19.99", "50"]);

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(arrayBuffer);

    const result = await extractXlsx(buf);
    expect(result.text).toContain("TestSheet");
    expect(result.text).toContain("Widget");
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    expect(result.chunks[0]!.text).toContain("Product: Widget");
    expect(result.chunks[0]!.text).toContain("Price: 9.99");
  });
});

describe("extractByMime dispatch", () => {
  it("routes text/plain to plain text extractor", async () => {
    const { extractByMime } = await import("./extract.ts");
    const buf = Buffer.from("simple text content", "utf-8");
    const result = await extractByMime(buf, "text/plain");
    expect(result.text).toBe("simple text content");
  });

  it("routes text/csv to CSV extractor", async () => {
    const { extractByMime } = await import("./extract.ts");
    const buf = Buffer.from("a,b\n1,2\n", "utf-8");
    const result = await extractByMime(buf, "text/csv");
    expect(result.chunks[0]!.text).toContain("a: 1");
  });
});
