import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { buildEmployeePeriodView } from "./employee-period-view";
import type { ExpectedSubmissionPeriod } from "./expected-periods";

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
	endDate: string,
	status: "pending" | "approved" | "rejected" | "withdrawn" | "outdated",
	extra: {
		decisionReason?: string;
		closedCause?: "employee" | "change";
		submittedAt?: string;
	} = {},
) => ({
	startDate,
	endDate,
	status,
	decisionReason: extra.decisionReason ?? null,
	closedCause: extra.closedCause ?? null,
	submittedAt: new Date(extra.submittedAt ?? `${endDate}T12:00:00Z`),
});

describe("the employee's period view", () => {
	const today = parsePlainDate("2026-03-15");
	const periods = [
		week("2026-02-23", "2026-03-01"),
		week("2026-03-02", "2026-03-08"),
		week("2026-03-09", "2026-03-15"),
		week("2026-03-16", "2026-03-22"),
	];

	it("lists the started periods newest first, offering Submit from the last day onward", () => {
		const view = buildEmployeePeriodView({ periods, submissions: [], today });
		expect(view.map((row) => [row.startDate, row.status, row.canSubmit])).toEqual([
			["2026-03-09", "awaiting_submission", true],
			["2026-03-02", "awaiting_submission", true],
			["2026-02-23", "awaiting_submission", true],
		]);
		expect(
			buildEmployeePeriodView({ periods, submissions: [], today: parsePlainDate("2026-03-14") })[0],
		).toMatchObject({ startDate: "2026-03-09", canSubmit: false, opensOn: "2026-03-15" });
	});

	it("shows each period's latest submission, with the rejection reason", () => {
		const view = buildEmployeePeriodView({
			periods,
			today,
			submissions: [
				submission("2026-02-23", "2026-03-01", "approved"),
				submission("2026-03-02", "2026-03-08", "rejected", {
					decisionReason: "Friday is missing",
					submittedAt: "2026-03-08T10:00:00Z",
				}),
				submission("2026-03-02", "2026-03-08", "pending", { submittedAt: "2026-03-09T10:00:00Z" }),
				submission("2026-03-09", "2026-03-15", "rejected", { decisionReason: "Wrong project" }),
			],
		});
		expect(
			view.map((row) => [row.startDate, row.status, row.rejectionReason, row.canSubmit]),
		).toEqual([
			["2026-03-09", "rejected", "Wrong project", true],
			["2026-03-02", "submitted", null, false],
			["2026-02-23", "approved", null, false],
		]);
	});

	it("keeps a submitted period that is no longer expected, with its fixed range", () => {
		const view = buildEmployeePeriodView({
			periods: [],
			today,
			submissions: [submission("2026-03-02", "2026-03-05", "pending")],
		});
		expect(view).toEqual([
			expect.objectContaining({
				startDate: "2026-03-02",
				endDate: "2026-03-05",
				status: "submitted",
				canSubmit: false,
			}),
		]);
	});

	it("shows a period sent back after a change", () => {
		const view = buildEmployeePeriodView({
			periods: [week("2026-03-02", "2026-03-08")],
			today,
			submissions: [submission("2026-03-02", "2026-03-08", "outdated", { closedCause: "change" })],
		});
		expect(view[0]).toMatchObject({ status: "sent_back_after_change", canSubmit: true });
	});
});
