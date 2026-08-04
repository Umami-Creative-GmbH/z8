import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

describe("Schedule-X runtime dependencies", () => {
	it("uses one Preact runtime for the calendar and signals", () => {
		const appRequire = createRequire(import.meta.url);
		const calendarRequire = createRequire(
			appRequire.resolve("@schedule-x/calendar/package.json"),
		);
		const signalsRequire = createRequire(
			calendarRequire.resolve("@preact/signals"),
		);
		const calendarPreact = dirname(
			realpathSync(calendarRequire.resolve("preact/package.json")),
		);
		const signalsPreact = dirname(
			realpathSync(signalsRequire.resolve("preact/package.json")),
		);

		expect(signalsPreact).toBe(calendarPreact);
	});
});
