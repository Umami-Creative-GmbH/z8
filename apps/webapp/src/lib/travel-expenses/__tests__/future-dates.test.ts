import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	isFutureDated,
	latestCalendarDate,
	nextSubmissionChange,
	submittableFrom,
} from "../future-dates";
import { parseMileageItemDraft } from "../mileage";
import { parsePerDiemDraft } from "../per-diem";
import { parseReceiptItemDraft } from "../receipt-report";
import { parseTripDetailsDraft } from "../trip-report";

/** Future-dated expense items and trips (#685), on the latest calendar date anywhere. */

// 2026-10-07 starts in Pacific/Kiritimati (UTC+14) at 2026-10-06T10:00Z.
const beforeChange = parseInstant("2026-10-06T09:59:59.999Z");
const atChange = parseInstant("2026-10-06T10:00:00Z");

describe("latestCalendarDate", () => {
	it("is the current date in the zone that is furthest ahead", () => {
		expect(latestCalendarDate(beforeChange)).toBe("2026-10-06");
		expect(latestCalendarDate(atChange)).toBe("2026-10-07");
	});
});

describe("isFutureDated", () => {
	it("refuses a date only until it is today somewhere on earth", () => {
		expect(isFutureDated("2026-10-07", beforeChange)).toBe(true);
		expect(isFutureDated("2026-10-07", atChange)).toBe(false);
		expect(isFutureDated("2026-10-06", beforeChange)).toBe(false);
		expect(isFutureDated("2026-10-08", atChange)).toBe(true);
	});
});

describe("submittableFrom", () => {
	it("is the instant the date starts in the zone that is furthest ahead", () => {
		expect(submittableFrom("2026-10-07").toString()).toBe("2026-10-06T10:00:00Z");
	});
});

describe("drafts", () => {
	it("still accept future dates while a trip is planned", () => {
		expect(
			parseReceiptItemDraft({
				expenseDate: "2099-01-15",
				category: null,
				description: null,
				amount: null,
				currency: null,
				paidBy: null,
				accountingReference: null,
			}),
		).toMatchObject({ ok: true, draft: { expenseDate: "2099-01-15" } });
		expect(
			parseMileageItemDraft({
				expenseDate: "2099-01-15",
				route: null,
				distanceKm: null,
				vehicle: null,
				accountingReference: null,
			}),
		).toMatchObject({ ok: true, draft: { expenseDate: "2099-01-15" } });
		expect(
			parseTripDetailsDraft({
				purpose: null,
				startDate: "2099-01-14",
				endDate: "2099-01-16",
				timeZone: "Europe/Berlin",
				destinations: [],
			}),
		).toMatchObject({ ok: true, draft: { endDate: "2099-01-16" } });
		expect(
			parsePerDiemDraft({
				startDate: "2099-01-14",
				startTime: "08:00",
				startTimeZone: "Europe/Berlin",
				endDate: "2099-01-16",
				endTime: "18:00",
				endTimeZone: "Europe/Berlin",
				overnight: "away",
				prolongedWorkplace: false,
				meals: [],
			}),
		).toMatchObject({ ok: true, itinerary: { endDate: "2099-01-16" } });
	});
});

describe("nextSubmissionChange", () => {
	it("is the earliest date change or return still ahead", () => {
		const future = {
			dates: ["2026-10-07", "2026-10-09", "2026-09-30"],
			instants: [parseInstant("2026-10-06T12:00:00Z")],
		};
		expect(nextSubmissionChange(beforeChange, future)?.toString()).toBe("2026-10-06T10:00:00Z");
		// At the change itself the date is already submittable; the return is next.
		expect(nextSubmissionChange(atChange, future)?.toString()).toBe("2026-10-06T12:00:00Z");
		expect(nextSubmissionChange(parseInstant("2026-10-06T12:00:00Z"), future)?.toString()).toBe(
			"2026-10-08T10:00:00Z",
		);
	});

	it("is null when nothing is future-dated", () => {
		expect(
			nextSubmissionChange(atChange, {
				dates: ["2026-10-07"],
				instants: [parseInstant("2026-10-06T10:00:00Z")],
			}),
		).toBeNull();
		expect(nextSubmissionChange(atChange, { dates: [], instants: [] })).toBeNull();
	});
});
