import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type EmploymentPeriodForRetention,
	isDueForDeletion,
	retentionDueDate,
	retentionStart,
} from "./retention";

const BERLIN = "Europe/Berlin";

/** A period a departure closed: `endedAt` is the cutoff, the start of the day after the last day. */
function leftAfter(lastDay: string, timezone = BERLIN): EmploymentPeriodForRetention {
	const cutoff = Temporal.PlainDate.from(lastDay)
		.add({ days: 1 })
		.toZonedDateTime({ timeZone: timezone })
		.toInstant();
	return { status: "closed", endedAt: cutoff };
}

const open: EmploymentPeriodForRetention = { status: "open", endedAt: null };

describe("retention start", () => {
	it("is the end of the departure year when the document is older", () => {
		expect(
			retentionStart({
				periods: [leftAfter("2027-06-30")],
				documentDate: "2026-03-31",
				timezone: BERLIN,
			})?.toString(),
		).toBe("2028-01-01");
	});

	it("is the end of the document year when the document is newer than the departure", () => {
		expect(
			retentionStart({
				periods: [leftAfter("2027-12-31")],
				documentDate: "2028-01-15",
				timezone: BERLIN,
			})?.toString(),
		).toBe("2029-01-01");
	});

	it("takes the year of the last day, not of the cutoff on the next morning", () => {
		expect(
			retentionStart({
				periods: [leftAfter("2027-12-31")],
				documentDate: "2020-01-01",
				timezone: BERLIN,
			})?.toString(),
		).toBe("2028-01-01");
	});

	it("evaluates the last day in the organization's timezone", () => {
		const newYork = "America/New_York";
		// The cutoff 2028-01-01T00:00 in New York is 05:00 UTC on 2028-01-01.
		expect(
			retentionStart({
				periods: [leftAfter("2027-12-31", newYork)],
				documentDate: "2020-01-01",
				timezone: newYork,
			})?.toString(),
		).toBe("2028-01-01");
		// The same instant read in Auckland is already the afternoon of 2028-01-01.
		expect(
			retentionStart({
				periods: [leftAfter("2027-12-31", newYork)],
				documentDate: "2020-01-01",
				timezone: "Pacific/Auckland",
			})?.toString(),
		).toBe("2029-01-01");
	});

	it("uses the last of several ended employment periods", () => {
		expect(
			retentionStart({
				periods: [leftAfter("2030-03-31"), leftAfter("2025-06-30")],
				documentDate: "2024-01-01",
				timezone: BERLIN,
			})?.toString(),
		).toBe("2031-01-01");
	});

	it("does not exist while the employee has an open employment period, also after a rehire", () => {
		expect(
			retentionStart({ periods: [open], documentDate: "2026-01-01", timezone: BERLIN }),
		).toBeNull();
		expect(
			retentionStart({
				periods: [leftAfter("2027-06-30"), open],
				documentDate: "2026-01-01",
				timezone: BERLIN,
			}),
		).toBeNull();
	});

	it("does not exist without a known employment end", () => {
		expect(
			retentionStart({ periods: [], documentDate: "2026-01-01", timezone: BERLIN }),
		).toBeNull();
		expect(
			retentionStart({
				periods: [{ status: "legacy_unknown", endedAt: null }],
				documentDate: "2026-01-01",
				timezone: BERLIN,
			}),
		).toBeNull();
	});
});

describe("due for deletion", () => {
	const anna = [leftAfter("2027-06-30")];

	it("Anna's 2026 and 2027 payslips are due on 2034-01-01 with a 6-year period", () => {
		for (const documentDate of ["2026-05-31", "2027-06-30"]) {
			expect(
				retentionDueDate({
					periods: anna,
					documentDate,
					timezone: BERLIN,
					retentionYears: 6,
				})?.toString(),
			).toBe("2034-01-01");
			const due = (today: string) =>
				isDueForDeletion({
					periods: anna,
					documentDate,
					timezone: BERLIN,
					retentionYears: 6,
					today: Temporal.PlainDate.from(today),
				});
			expect(due("2033-12-31")).toBe(false);
			expect(due("2034-01-01")).toBe(true);
			expect(due("2040-07-01")).toBe(true);
		}
	});

	it("is never due in a category without a retention period", () => {
		expect(
			retentionDueDate({
				periods: anna,
				documentDate: "2026-05-31",
				timezone: BERLIN,
				retentionYears: null,
			}),
		).toBeNull();
		expect(
			isDueForDeletion({
				periods: anna,
				documentDate: "2026-05-31",
				timezone: BERLIN,
				retentionYears: null,
				today: Temporal.PlainDate.from("2100-01-01"),
			}),
		).toBe(false);
	});

	it("is never due after a rehire", () => {
		expect(
			isDueForDeletion({
				periods: [...anna, open],
				documentDate: "2026-05-31",
				timezone: BERLIN,
				retentionYears: 6,
				today: Temporal.PlainDate.from("2100-01-01"),
			}),
		).toBe(false);
	});

	it("a shorter period makes documents due earlier", () => {
		expect(
			retentionDueDate({
				periods: anna,
				documentDate: "2026-05-31",
				timezone: BERLIN,
				retentionYears: 2,
			})?.toString(),
		).toBe("2030-01-01");
	});
});
