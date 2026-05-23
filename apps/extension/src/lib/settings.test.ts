import { describe, expect, test } from "vitest";
import { normalizeWebappUrl, validateWebappUrl } from "./settings";

describe("validateWebappUrl", () => {
  test("allows HTTPS URLs", () => {
    expect(validateWebappUrl("https://app.z8-time.app")).toBe(true);
  });

  test("allows local HTTP development URLs", () => {
    expect(validateWebappUrl("http://localhost:3000")).toBe(true);
    expect(validateWebappUrl("http://127.0.0.1:3000")).toBe(true);
  });

  test("rejects non-local HTTP URLs", () => {
    expect(validateWebappUrl("http://example.com")).toBe(false);
  });

  test("rejects URLs with embedded credentials", () => {
    expect(validateWebappUrl("https://user:password@app.z8-time.app")).toBe(false);
  });
});

describe("normalizeWebappUrl", () => {
  test("trims whitespace and trailing slashes", () => {
    expect(normalizeWebappUrl(" https://app.z8-time.app/// ")).toBe("https://app.z8-time.app");
  });
});
