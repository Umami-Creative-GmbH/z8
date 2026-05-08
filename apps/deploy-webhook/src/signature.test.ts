import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubSignature } from "./signature.js";

describe("verifyGitHubSignature", () => {
  it("accepts a valid sha256 signature", () => {
    const body = Buffer.from('{"zen":"keep it logically awesome"}');
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyGitHubSignature(body, signature, "secret")).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const body = Buffer.from("{}");
    expect(verifyGitHubSignature(body, "sha256=bad", "secret")).toBe(false);
  });

  it("rejects missing or non-sha256 signatures", () => {
    expect(verifyGitHubSignature(Buffer.from("{}"), undefined, "secret")).toBe(false);
    expect(verifyGitHubSignature(Buffer.from("{}"), "sha1=abc", "secret")).toBe(false);
  });
});
