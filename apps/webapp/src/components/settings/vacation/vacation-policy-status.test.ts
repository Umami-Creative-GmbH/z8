import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { isPolicySuperseded, organizationToday } from "./vacation-policy-status";

const at = (iso: string) => Temporal.Instant.from(iso);

describe("organizationToday", () => {
	it("uses the organization's calendar day, not UTC's", () => {
		// 23:30 UTC on 31 March is already 1 April in Berlin (UTC+2).
		expect(organizationToday("Europe/Berlin", at("2026-03-31T22:30:00Z"))?.toString()).toBe(
			"2026-04-01",
		);
		// 02:00 UTC on 1 April is still 31 March in New York (UTC-4).
		expect(organizationToday("America/New_York", at("2026-04-01T02:00:00Z"))?.toString()).toBe(
			"2026-03-31",
		);
	});

	it("is unknown without a valid timezone", () => {
		expect(organizationToday(undefined, at("2026-04-01T00:00:00Z"))).toBeNull();
		expect(organizationToday("Not/AZone", at("2026-04-01T00:00:00Z"))).toBeNull();
	});
});

describe("isPolicySuperseded", () => {
	it("supersedes a policy from the organization's next day after its last valid day", () => {
		const validUntil = "2026-03-31";

		// Berlin, one minute before local midnight: 31 March is still valid.
		expect(
			isPolicySuperseded(validUntil, organizationToday("Europe/Berlin", at("2026-03-31T21:59:00Z"))),
		).toBe(false);
		// Berlin, local midnight: UTC still says 31 March, but the organization is in 1 April.
		expect(
			isPolicySuperseded(validUntil, organizationToday("Europe/Berlin", at("2026-03-31T22:00:00Z"))),
		).toBe(true);
	});

	it("keeps a policy valid while the organization is still on its last day after UTC midnight", () => {
		const validUntil = "2026-03-31";

		// 03:59 UTC on 1 April is 23:59 on 31 March in New York.
		expect(
			isPolicySuperseded(
				validUntil,
				organizationToday("America/New_York", at("2026-04-01T03:59:00Z")),
			),
		).toBe(false);
		expect(
			isPolicySuperseded(
				validUntil,
				organizationToday("America/New_York", at("2026-04-01T04:00:00Z")),
			),
		).toBe(true);
	});

	it("never supersedes an open-ended policy or one compared against an unknown day", () => {
		const today = Temporal.PlainDate.from("2026-06-01");
		expect(isPolicySuperseded(null, today)).toBe(false);
		expect(isPolicySuperseded("2026-01-01", null)).toBe(false);
		expect(isPolicySuperseded("not-a-date", today)).toBe(false);
	});
});
