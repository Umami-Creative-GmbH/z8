import { describe, expect, it } from "vitest";

import { createTimeClockPayload } from "./time-clock-payload";

describe("createTimeClockPayload", () => {
  it("captures the current instant, IANA timezone, and offset for clock actions", () => {
    const instant = new Date("2026-07-10T12:00:00.000Z");

    expect(
      createTimeClockPayload(
        { action: "clock_out" },
        {
          now: () => instant,
          timeZone: () => "America/New_York",
          offsetMinutes: () => -240,
        },
      ),
    ).toEqual({
      action: "clock_out",
      instant: "2026-07-10T12:00:00.000Z",
      timezone: "America/New_York",
      utcOffsetMinutes: -240,
    });
  });
});
