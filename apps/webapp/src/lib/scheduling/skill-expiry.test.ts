import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	isExpiredSkillOn,
	parseSkillExpiryDate,
	skillExpiryBadge,
	skillExpiryToday,
} from "./skill-expiry";

describe("isExpiredSkillOn", () => {
	it("covers a shift on the skill expiry date", () => {
		expect(isExpiredSkillOn("2026-11-30", "2026-11-30")).toBe(false);
	});

	it("is an expired skill for a shift the day after", () => {
		expect(isExpiredSkillOn("2026-11-30", "2026-12-01")).toBe(true);
	});

	it("covers every shift before the skill expiry date", () => {
		expect(isExpiredSkillOn("2026-11-30", "2026-11-29")).toBe(false);
		expect(isExpiredSkillOn("2026-11-30", Temporal.PlainDate.from("2025-01-01"))).toBe(false);
	});

	it("never expires a skill without a skill expiry date", () => {
		expect(isExpiredSkillOn(null, "2099-12-31")).toBe(false);
	});

	it("compares across months and years as calendar days", () => {
		expect(isExpiredSkillOn("2026-12-31", "2027-01-01")).toBe(true);
		expect(isExpiredSkillOn("2028-02-29", "2028-02-29")).toBe(false);
	});
});

describe("skillExpiryBadge", () => {
	const window = { today: "2026-10-31", expiringSoonDays: 30 };

	it("shows nothing for a skill that never expires", () => {
		expect(skillExpiryBadge({ ...window, expiresAt: null })).toBeNull();
	});

	it("shows nothing before the expiring soon window", () => {
		expect(skillExpiryBadge({ ...window, expiresAt: "2026-12-01" })).toBeNull();
	});

	it("is expiring soon from the window's last day to the skill expiry date", () => {
		expect(skillExpiryBadge({ ...window, expiresAt: "2026-11-30" })).toBe("expiringSoon");
		expect(skillExpiryBadge({ ...window, expiresAt: "2026-11-01" })).toBe("expiringSoon");
	});

	it("is still valid, so expiring soon, on its last valid day", () => {
		expect(skillExpiryBadge({ ...window, expiresAt: "2026-10-31" })).toBe("expiringSoon");
	});

	it("is expired from the day after the skill expiry date", () => {
		expect(skillExpiryBadge({ ...window, expiresAt: "2026-10-30" })).toBe("expired");
	});
});

describe("skillExpiryToday", () => {
	it("is the organization's calendar day, not the UTC day", () => {
		// 23:30 UTC on 30 November is already 1 December in Berlin.
		const now = Temporal.Instant.from("2026-11-30T23:30:00Z");

		expect(skillExpiryToday(now, "Europe/Berlin").toString()).toBe("2026-12-01");
		expect(skillExpiryToday(now, "UTC").toString()).toBe("2026-11-30");
		expect(isExpiredSkillOn("2026-11-30", skillExpiryToday(now, "Europe/Berlin"))).toBe(true);
	});

	it("falls back to UTC for an unknown zone", () => {
		const now = Temporal.Instant.from("2026-11-30T23:30:00Z");

		expect(skillExpiryToday(now, "Mars/Olympus").toString()).toBe("2026-11-30");
	});
});

describe("parseSkillExpiryDate", () => {
	it("accepts a plain date and an empty date", () => {
		expect(parseSkillExpiryDate("2026-11-30")).toEqual({ ok: true, value: "2026-11-30" });
		expect(parseSkillExpiryDate(undefined)).toEqual({ ok: true, value: null });
		expect(parseSkillExpiryDate(null)).toEqual({ ok: true, value: null });
		expect(parseSkillExpiryDate("")).toEqual({ ok: true, value: null });
	});

	it.each(["2026-11-30T00:00:00.000Z", "30.11.2026", "2026-02-30", 20261130])(
		"refuses %s",
		(value) => {
			expect(parseSkillExpiryDate(value)).toEqual({
				ok: false,
				message: "Enter the expiry date as YYYY-MM-DD.",
			});
		},
	);
});
