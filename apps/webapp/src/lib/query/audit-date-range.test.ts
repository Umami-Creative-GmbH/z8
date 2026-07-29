import { describe, expect, it } from "vitest";
import { resolveAuditDateRange } from "./audit-date-range";

describe("resolveAuditDateRange", () => {
	it("uses the organization zone and an exclusive next-day end across DST", () => {
		const range = resolveAuditDateRange(
			"2026-03-29",
			"2026-03-29",
			"Europe/Berlin",
		);

		expect(range.start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
		expect(range.endExclusive.toISOString()).toBe("2026-03-29T22:00:00.000Z");
	});

	it("rejects a reversed date range", () => {
		expect(() =>
			resolveAuditDateRange("2026-04-02", "2026-04-01", "UTC"),
		).toThrow("Audit log end date must be on or after the start date");
	});
});
