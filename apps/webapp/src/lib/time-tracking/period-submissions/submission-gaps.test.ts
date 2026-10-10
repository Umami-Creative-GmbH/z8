import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import { periodSubmissionGaps } from "./submission-gaps";

function week(start: string, end: string): ExpectedSubmissionPeriod {
	return {
		cadence: { kind: "weekly", weekStartDay: "monday" },
		timezone: "Europe/Berlin",
		startDate: parsePlainDate(start),
		endDate: parsePlainDate(end),
		cadenceStartDate: parsePlainDate(start),
		cadenceEndDate: parsePlainDate(end),
	};
}

const submission = (
	startDate: string,
	status: "pending" | "approved" | "rejected" | "withdrawn" | "outdated",
	submittedAt: string,
	closedCause: "employee" | "change" | null = null,
) => ({ startDate, status, closedCause, submittedAt: new Date(submittedAt) });

describe("period submission gaps", () => {
	it("lists ended periods without a submission, but not a period still running", () => {
		const gaps = periodSubmissionGaps({
			periods: [week("2026-03-23", "2026-03-29"), week("2026-03-30", "2026-04-05")],
			submissions: [],
			today: parsePlainDate("2026-04-05"),
		});

		expect(gaps).toEqual([
			{ startDate: "2026-03-23", endDate: "2026-03-29", status: "awaiting_submission" },
		]);
	});

	it("leaves out approved periods and names the status of every other latest submission", () => {
		const gaps = periodSubmissionGaps({
			periods: [
				week("2026-03-02", "2026-03-08"),
				week("2026-03-09", "2026-03-15"),
				week("2026-03-16", "2026-03-22"),
				week("2026-03-23", "2026-03-29"),
				week("2026-03-30", "2026-04-05"),
			],
			submissions: [
				submission("2026-03-02", "rejected", "2026-03-09T08:00:00Z"),
				submission("2026-03-02", "approved", "2026-03-10T08:00:00Z"),
				submission("2026-03-09", "pending", "2026-03-16T08:00:00Z"),
				submission("2026-03-16", "rejected", "2026-03-23T08:00:00Z"),
				submission("2026-03-23", "outdated", "2026-03-30T08:00:00Z", "change"),
				submission("2026-03-30", "withdrawn", "2026-04-06T08:00:00Z", "employee"),
			],
			today: parsePlainDate("2026-04-10"),
		});

		expect(gaps.map((gap) => [gap.startDate, gap.status])).toEqual([
			["2026-03-09", "submitted"],
			["2026-03-16", "rejected"],
			["2026-03-23", "sent_back_after_change"],
			["2026-03-30", "awaiting_submission"],
		]);
	});
});
