import { describe, expect, it } from "vitest";
import { resolveCoveragePlainDates } from "./coverage.service";

describe("coverage service timezone boundaries", () => {
	it("uses Berlin plain dates and excludes the exclusive end under every host timezone", () => {
		const dates = resolveCoveragePlainDates(
			new Date("2026-01-04T23:00:00.000Z"),
			new Date("2026-01-11T23:00:00.000Z"),
			"Europe/Berlin",
		);

		expect(dates.map((date) => date.toString())).toEqual([
			"2026-01-05",
			"2026-01-06",
			"2026-01-07",
			"2026-01-08",
			"2026-01-09",
			"2026-01-10",
			"2026-01-11",
		]);
	});
});
