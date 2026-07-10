import { afterEach, describe, expect, test, vi } from "vitest";
import timeSource from "./time.ts?raw";
import useTimerSource from "../popup/hooks/useTimer.ts?raw";
import { formatActionTime } from "./time";

describe("formatActionTime", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

  test("formats today's action time using the user's locale", () => {
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));

    expect(formatActionTime("2026-05-23T10:30:00.000Z")).not.toBe("Unknown time");
  });

	test("returns a fallback for invalid timestamps", () => {
		expect(formatActionTime("not-a-date")).toBe("Unknown time");
	});

	test("parses canonical timestamps from an explicit UTC origin", () => {
		expect(timeSource).toMatch(/DateTime\.fromISO\(timestamp, \{ zone: "utc" \}\)/);
	});

	test("calculates elapsed time from an explicit UTC origin", () => {
		expect(useTimerSource).toContain('DateTime.fromISO(startTime, { zone: "utc" })');
	});
});
