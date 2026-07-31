import { describe, expect, it } from "vitest";
import { resolveCalendarInitialDate } from "./initial-date";

describe("resolveCalendarInitialDate", () => {
	it("accepts a valid strict calendar date", () => {
		expect(resolveCalendarInitialDate("2026-06-12", "2026-06-01")).toBe(
			"2026-06-12",
		);
	});

	it.each([undefined, "", "2026-02-30", "06/12/2026"])(
		"falls back for invalid requested date %s",
		(requestedDate) => {
			expect(resolveCalendarInitialDate(requestedDate, "2026-06-01")).toBe(
				"2026-06-01",
			);
		},
	);
});
