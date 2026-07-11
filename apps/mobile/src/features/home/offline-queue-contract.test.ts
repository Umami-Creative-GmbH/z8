import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("mobile time clock delivery", () => {
  it("posts clock actions directly and has no offline replay queue", () => {
    const source = readFileSync(fileURLToPath(new URL("./use-home-query.ts", import.meta.url)), "utf8");

    expect(source).toContain('post("/api/mobile/time-clock", action)');
    expect(source).not.toContain("createTimeClockPayload(action)");
    expect(source).not.toMatch(/queue|AsyncStorage|enqueue|replay/i);
  });
});
