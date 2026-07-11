import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { createClockAction, getActionTimezone } from "./clock-action";

const fixedNow = DateTime.fromISO("2026-07-10T12:30:00.123Z", { zone: "utc" });

function fakeIntl(timeZone: string) {
  return {
    DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }),
  } as Pick<typeof Intl, "DateTimeFormat">;
}

describe("extension clock action capture", () => {
  it("captures an immutable UTC instant and timezone evidence at the clock interaction", () => {
    expect(
      createClockAction({
        type: "clock_in",
        now: fixedNow,
        intlApi: fakeIntl("Asia/Kathmandu"),
        actionId: "action-123",
      }),
    ).toEqual({
      id: "action-123",
      type: "clock_in",
      timestamp: "2026-07-10T12:30:00.123Z",
      browserTimezone: "Asia/Kathmandu",
      utcOffsetMinutes: 345,
    });
  });

  it("falls back to UTC evidence for an invalid device timezone without using the host timezone", () => {
    expect(
      createClockAction({
        type: "clock_out",
        now: fixedNow,
        intlApi: fakeIntl("Not/AZone"),
        actionId: "action-456",
      }),
    ).toEqual({
      id: "action-456",
      type: "clock_out",
      timestamp: "2026-07-10T12:30:00.123Z",
      browserTimezone: "UTC",
      utcOffsetMinutes: 0,
    });
    expect(getActionTimezone(fakeIntl("Not/AZone"))).toBeNull();
  });
});
