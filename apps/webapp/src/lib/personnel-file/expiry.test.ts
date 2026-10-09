import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_EXPIRY_REMINDER_LEAD_DAYS,
	describeExpiry,
	dueExpiryReminder,
	expiryWindowEnd,
	validateExpiryReminderLeadDays,
} from "./expiry";
import { todayInOrganization } from "./organization-day";

const instant = (value: string) => Temporal.Instant.from(value);
const dayIn = (now: Temporal.Instant, timezone: string) =>
	todayInOrganization(now, timezone).toString();

describe("dueExpiryReminder", () => {
	const certificate = { expiryDate: "2026-11-30", leadDays: 30 };

	it("is not due before the lead time starts", () => {
		expect(dueExpiryReminder({ ...certificate, today: "2026-10-30" })).toBeNull();
	});

	it("sends the upcoming reminder from the first day within the lead time", () => {
		expect(dueExpiryReminder({ ...certificate, today: "2026-10-31" })).toBe("upcoming");
		expect(dueExpiryReminder({ ...certificate, today: "2026-11-29" })).toBe("upcoming");
	});

	it("sends the expired-today reminder on the expiry date", () => {
		expect(dueExpiryReminder({ ...certificate, today: "2026-11-30" })).toBe("expired_today");
	});

	it("sends nothing after the expiry date", () => {
		expect(dueExpiryReminder({ ...certificate, today: "2026-12-01" })).toBeNull();
	});

	it("respects a shorter lead time", () => {
		expect(
			dueExpiryReminder({ expiryDate: "2026-11-30", leadDays: 7, today: "2026-11-22" }),
		).toBeNull();
		expect(dueExpiryReminder({ expiryDate: "2026-11-30", leadDays: 7, today: "2026-11-23" })).toBe(
			"upcoming",
		);
	});

	it("takes the organization's calendar day, not the UTC day", () => {
		// 23:30 UTC on 30 October is already 31 October in Berlin (UTC+1 after DST ends).
		const now = instant("2026-10-30T23:30:00Z");
		expect(
			dueExpiryReminder({ ...certificate, today: dayIn(now, "Europe/Berlin") }),
		).toBe("upcoming");
		expect(
			dueExpiryReminder({ ...certificate, today: dayIn(now, "UTC") }),
		).toBeNull();
		// 05:00 UTC on 30 November is still 29 November in Los Angeles.
		const morning = instant("2026-11-30T05:00:00Z");
		expect(
			dueExpiryReminder({
				...certificate,
				today: dayIn(morning, "America/Los_Angeles"),
			}),
		).toBe("upcoming");
		expect(
			dueExpiryReminder({ ...certificate, today: dayIn(morning, "Europe/Berlin") }),
		).toBe("expired_today");
	});
});

describe("expiryWindowEnd", () => {
	it("is the last expiry date within the lead time", () => {
		expect(expiryWindowEnd({ today: "2026-10-31", leadDays: 30 })).toBe("2026-11-30");
		expect(expiryWindowEnd({ today: "2028-02-28", leadDays: 1 })).toBe("2028-02-29");
	});
});

describe("describeExpiry", () => {
	it("counts the days left until the expiry date", () => {
		expect(describeExpiry({ today: "2026-10-31", expiryDate: "2026-11-30" })).toEqual({
			status: "upcoming",
			days: 30,
		});
	});

	it("says a document expires today", () => {
		expect(describeExpiry({ today: "2026-11-30", expiryDate: "2026-11-30" })).toEqual({
			status: "today",
			days: 0,
		});
	});

	it("counts the days since an expired document's expiry date", () => {
		expect(describeExpiry({ today: "2027-01-02", expiryDate: "2026-11-30" })).toEqual({
			status: "expired",
			days: 33,
		});
	});
});

describe("validateExpiryReminderLeadDays", () => {
	it("defaults to 30 days", () => {
		expect(DEFAULT_EXPIRY_REMINDER_LEAD_DAYS).toBe(30);
	});

	it("accepts whole days from 1 to 365", () => {
		expect(validateExpiryReminderLeadDays(1)).toEqual({ ok: true, value: 1 });
		expect(validateExpiryReminderLeadDays(365)).toEqual({ ok: true, value: 365 });
		expect(validateExpiryReminderLeadDays("45")).toEqual({ ok: true, value: 45 });
	});

	it.each([0, 366, 1.5, -3, "", "abc", null, undefined])("refuses %s", (value) => {
		expect(validateExpiryReminderLeadDays(value)).toEqual({
			ok: false,
			message: "Enter a lead time between 1 and 365 days.",
		});
	});
});
