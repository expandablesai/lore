// "Local or cloud" is decided from the endpoint, not the provider label: a
// gateway on another box is local, and a hosted API is not, whatever the vendor
// is called.
import { describe, expect, it } from "vitest";
import { isLocalEndpoint } from "./endpoint.js";

describe("isLocalEndpoint", () => {
  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:11434/v1",
    "http://[::1]:11434/v1",
    "http://10.20.10.52:11434/v1",
    "http://172.18.0.9:8080/v1",
    "http://192.168.50.28/v1",
    "http://169.254.10.1/v1",
    "http://100.64.0.7/v1",
    "http://ollama.home.arpa:11434/v1",
    "http://gpu.local:8000/v1",
  ])("treats %s as local", (url) => {
    expect(isLocalEndpoint(url)).toBe(true);
  });

  it.each([
    "https://api.openai.com/v1",
    "https://api.deepseek.com/v1",
    "https://gateway.example.com/v1",
    "http://172.15.0.1/v1",
    "http://172.32.0.1/v1",
    "http://8.8.8.8/v1",
  ])("treats %s as cloud", (url) => {
    expect(isLocalEndpoint(url)).toBe(false);
  });

  it("treats an unparseable URL as cloud rather than guessing", () => {
    expect(isLocalEndpoint("not a url")).toBe(false);
  });
});
