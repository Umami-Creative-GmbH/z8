import { describe, expect, test, vi } from "vitest";
import { formatActionTime } from "./time";

describe("formatActionTime", () => {
  test("formats today's action time using the user's locale", () => {
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));

    expect(formatActionTime("2026-05-23T10:30:00.000Z")).not.toBe("Unknown time");
  });

  test("returns a fallback for invalid timestamps", () => {
    expect(formatActionTime("not-a-date")).toBe("Unknown time");
  });
});
