import { Temporal } from "temporal-polyfill";
import { expect, it } from "vitest";
import { enrollmentNotices, formatMfaDeadline } from "./notices";

it("skips reminder instants already passed without dropping the mandatory assignment", () => {
	expect(
		enrollmentNotices(
			"2026-10-17T10:00:00Z",
			Temporal.Instant.from("2026-10-16T10:00:00Z"),
		),
	).toEqual([{ kind: "assigned", dueAt: "2026-10-16T10:00:00Z" }]);
});

it("keeps organization-zone deadline display stable when the viewer timezone changes", () => {
	const previous = process.env.TZ;
	try {
		process.env.TZ = "Pacific/Honolulu";
		const first = formatMfaDeadline("2026-10-25T01:30:00Z", "Europe/Berlin");
		process.env.TZ = "Asia/Tokyo";
		expect(formatMfaDeadline("2026-10-25T01:30:00Z", "Europe/Berlin")).toBe(
			first,
		);
		expect(first).toContain("Europe/Berlin");
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});
