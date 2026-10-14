import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	fillNotificationTemplate,
	formatNotificationParams,
	notificationParam,
} from "./notification-params";

// Intl separates some parts with no-break or thin spaces; compare the visible text.
function visible(values: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [
			key,
			typeof value === "string" ? value.replace(/[   ]/g, " ") : value,
		]),
	);
}

// Stored as JSON in `notification.metadata`, so every test round-trips the params.
function stored<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

const params = stored({
	day: notificationParam.plainDate(parsePlainDate("2026-10-12")),
	days: notificationParam.plainDateRange(
		parsePlainDate("2026-10-12"),
		parsePlainDate("2026-10-14"),
	),
	// A time_entry captured at UTC+01:00: 06:00Z is 07:00 there.
	clockedOut: notificationParam.entryInstant(parseInstant("2026-10-25T06:00:00Z"), 60),
	// Another instant, in the organization's zone: 06:00Z is 02:00 in New York (EDT).
	expiresAt: notificationParam.zonedInstant(
		parseInstant("2026-10-25T06:00:00Z"),
		"America/New_York",
	),
	worked: notificationParam.duration(450),
	amount: notificationParam.money("1234.50", "EUR"),
	teamName: "Operations",
	count: 3,
});

describe("typed notification params", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("formats every kind in English", () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		expect(visible(formatNotificationParams(params, { locale: "en" }))).toEqual({
			day: "Oct 12, 2026",
			days: "Oct 12 – 14, 2026",
			clockedOut: "Oct 25, 2026, 7:00 AM",
			expiresAt: "Oct 25, 2026, 2:00 AM (America/New_York)",
			worked: "7 hours 30 minutes",
			amount: "€1,234.50",
			teamName: "Operations",
			count: 3,
		});
	});

	it("formats every kind in German", () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		expect(visible(formatNotificationParams(params, { locale: "de" }))).toEqual({
			day: "12. Okt. 2026",
			days: "12.–14. Okt. 2026",
			clockedOut: "25. Okt. 2026, 07:00",
			expiresAt: "25. Okt. 2026, 02:00 (America/New_York)",
			worked: "7 Stunden 30 Minuten",
			amount: "1.234,50 €",
			teamName: "Operations",
			count: 3,
		});
	});

	it("formats every kind in French", () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		expect(visible(formatNotificationParams(params, { locale: "fr" }))).toEqual({
			day: "12 oct. 2026",
			days: "12–14 oct. 2026",
			clockedOut: "25 oct. 2026, 07:00",
			expiresAt: "25 oct. 2026, 02:00 (America/New_York)",
			worked: "7 heures 30 minutes",
			amount: "1 234,50 €",
			teamName: "Operations",
			count: 3,
		});
	});

	it("follows the recipient's hour cycle when it is known", () => {
		expect(
			formatNotificationParams(
				{ at: notificationParam.entryInstant(parseInstant("2026-10-25T06:00:00Z"), 60, "time") },
				{ locale: "en", timeFormat: "24h" },
			),
		).toEqual({ at: "07:00" });
	});

	it("drops values ICU cannot format safely and keeps raw text for broken typed values", () => {
		expect(
			formatNotificationParams(
				{
					createdAt: new Date("2026-06-01T00:00:00.000Z"),
					enabled: true,
					nullable: null,
					list: ["Operations"],
					nested: { teamName: "Operations" },
					brokenDay: { kind: "plainDate", date: "not-a-date" },
					largeCount: 2n,
				},
				{ locale: "en" },
			),
		).toEqual({ createdAt: "2026-06-01T00:00:00.000Z", brokenDay: "not-a-date", largeCount: 2n });
	});

	it("fills a stored English default with formatted params", () => {
		expect(
			fillNotificationTemplate("Clocked out at {clockedOut} after {worked} in {teamName}.", params),
		).toBe("Clocked out at Oct 25, 2026, 7:00 AM after 7 hours 30 minutes in Operations.");
	});
});
