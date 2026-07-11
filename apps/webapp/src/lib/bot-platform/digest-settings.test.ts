import { describe, expect, it } from "vitest";
import { parseDigestSettings } from "./digest-settings";

describe("parseDigestSettings", () => {
	it.each(["00:00", "23:59"])("accepts the %s wall-clock time", (time) => {
		expect(parseDigestSettings({ time, timezone: "Asia/Kathmandu" })).toEqual({
			time,
			timezone: "Asia/Kathmandu",
		});
	});

	it.each(["9:30", "24:00", "09:30:00"])("rejects invalid time %s", (time) => {
		expect(() => parseDigestSettings({ time, timezone: "UTC" })).toThrow("digest time");
	});

	it("rejects an invalid schedule timezone", () => {
		expect(() => parseDigestSettings({ time: "09:30", timezone: "Mars/Olympus" })).toThrow(
			"digest timezone",
		);
	});
});
