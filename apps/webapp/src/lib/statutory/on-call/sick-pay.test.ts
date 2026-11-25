import { describe, expect, it } from "vitest";
import { sickPayNoteOf } from "./sick-pay";

describe("sickPayNoteOf", () => {
	it("names the end of the six weeks when they ended before the period", () => {
		expect(
			sickPayNoteOf({
				from: "2026-03-01",
				untilExclusive: "2026-04-01",
				days: 0,
				holidaysPaidAsHolidays: [],
				continuedPay: { from: "2026-01-05", untilExclusive: "2026-02-16" },
			}),
		).toEqual({ kind: "exhausted", lastDay: "2026-02-15" });
	});

	it("names the day the claim arises when the waiting time runs past the period", () => {
		expect(
			sickPayNoteOf({
				from: "2026-03-10",
				untilExclusive: "2026-03-30",
				days: 0,
				holidaysPaidAsHolidays: [],
				continuedPay: { from: "2026-03-30", untilExclusive: "2026-05-11" },
			}),
		).toEqual({ kind: "waiting", claimArises: "2026-03-30" });
	});

	it("says nothing is owed when the illness ends within the waiting time", () => {
		expect(
			sickPayNoteOf({
				from: "2026-03-10",
				untilExclusive: "2026-03-13",
				days: 0,
				holidaysPaidAsHolidays: [],
				continuedPay: null,
			}),
		).toEqual({ kind: "not_owed" });
	});

	it("gives the paid days and the span when continued pay covers only part of the period", () => {
		expect(
			sickPayNoteOf({
				from: "2026-03-10",
				untilExclusive: "2026-04-01",
				days: 2,
				holidaysPaidAsHolidays: [],
				continuedPay: { from: "2026-03-30", untilExclusive: "2026-05-11" },
			}),
		).toEqual({ kind: "paid", days: 2, limitedTo: { from: "2026-03-30", lastDay: "2026-05-10" } });
	});

	it("gives only the paid days when continued pay covers the illness's whole period", () => {
		expect(
			sickPayNoteOf({
				from: "2026-04-13",
				untilExclusive: "2026-04-23",
				days: 9,
				holidaysPaidAsHolidays: ["2026-04-15"],
				continuedPay: { from: "2026-04-13", untilExclusive: "2026-04-23" },
			}),
		).toEqual({ kind: "paid", days: 9, limitedTo: null });
	});
});
