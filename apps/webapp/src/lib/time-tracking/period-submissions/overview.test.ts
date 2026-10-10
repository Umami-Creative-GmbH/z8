import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { SubmissionCadenceChange } from "./cadence";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import {
	buildOverviewRows,
	listOverviewPeriods,
	type OverviewSubmission,
	periodSubmissionOverviewScope,
	selectOverviewPeriod,
} from "./overview";
import type { PeriodSubmissionStatus } from "./submission-status";

const weeklySince = (changedAt: string): SubmissionCadenceChange => ({
	cadence: { kind: "weekly", weekStartDay: "monday" },
	changedAt: parseInstant(changedAt),
});

describe("whom the overview shows", () => {
	const manager = { id: "manager-employee", organizationId: "org-1" };

	it("shows owners and admins every covered employee", () => {
		expect(
			periodSubmissionOverviewScope({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				employee: null,
			}),
		).toEqual({ kind: "all" });
	});

	it("shows managers the employees they manage in the active organization", () => {
		expect(
			periodSubmissionOverviewScope({
				accessTier: "manager",
				organizationId: "org-1",
				employee: manager,
			}),
		).toEqual({ kind: "managed", managerEmployeeId: "manager-employee" });
		expect(
			periodSubmissionOverviewScope({
				accessTier: "manager",
				organizationId: "org-2",
				employee: manager,
			}),
		).toBeNull();
		expect(
			periodSubmissionOverviewScope({
				accessTier: "manager",
				organizationId: "org-1",
				employee: null,
			}),
		).toBeNull();
	});

	it("refuses everyone else", () => {
		expect(
			periodSubmissionOverviewScope({
				accessTier: "member",
				organizationId: "org-1",
				employee: manager,
			}),
		).toBeNull();
	});
});

describe("the overview's selectable submission periods", () => {
	it("lists the periods that have started, newest first", () => {
		const periods = listOverviewPeriods({
			history: [weeklySince("2026-02-20T10:00:00Z")],
			timezone: "Europe/Berlin",
			today: parsePlainDate("2026-03-11"),
		});
		expect(periods.map((period) => `${period.startDate}..${period.endDate}`)).toEqual([
			"2026-03-09..2026-03-15",
			"2026-03-02..2026-03-08",
			"2026-02-23..2026-03-01",
		]);
	});

	it("lists nothing before a cadence was ever switched on", () => {
		expect(
			listOverviewPeriods({
				history: [],
				timezone: "Europe/Berlin",
				today: parsePlainDate("2026-03-11"),
			}),
		).toEqual([]);
	});
});

describe("the overview's selected period", () => {
	const periods = [
		{ startDate: "2026-03-09", endDate: "2026-03-15", cadence: "weekly" as const },
		{ startDate: "2026-03-02", endDate: "2026-03-08", cadence: "weekly" as const },
		{ startDate: "2026-02-23", endDate: "2026-03-01", cadence: "weekly" as const },
	];

	it("selects the requested period", () => {
		expect(selectOverviewPeriod(periods, "2026-02-23", parsePlainDate("2026-03-11"))).toEqual(
			periods[2],
		);
	});

	it("defaults to the newest period whose last day has come, when submissions are open", () => {
		expect(selectOverviewPeriod(periods, undefined, parsePlainDate("2026-03-11"))).toEqual(
			periods[1],
		);
		expect(selectOverviewPeriod(periods, "2026-01-05", parsePlainDate("2026-03-15"))).toEqual(
			periods[0],
		);
	});

	it("falls back to the running period when no period has ended yet", () => {
		expect(selectOverviewPeriod(periods.slice(0, 1), null, parsePlainDate("2026-03-11"))).toEqual(
			periods[0],
		);
		expect(selectOverviewPeriod([], null, parsePlainDate("2026-03-11"))).toBeNull();
	});
});

function week(start: string, end: string, timezone = "Europe/Berlin"): ExpectedSubmissionPeriod {
	return {
		cadence: { kind: "weekly", weekStartDay: "monday" },
		timezone,
		startDate: parsePlainDate(start),
		endDate: parsePlainDate(end),
		cadenceStartDate: parsePlainDate("2026-03-02"),
		cadenceEndDate: parsePlainDate("2026-03-08"),
	};
}

const submitted = (
	status: PeriodSubmissionStatus,
	extra: { closedCause?: "employee" | "change"; submittedAt?: string; startDate?: string } = {},
): OverviewSubmission => ({
	startDate: extra.startDate ?? "2026-03-02",
	endDate: "2026-03-08",
	status,
	closedCause: extra.closedCause ?? null,
	submittedAt: new Date(extra.submittedAt ?? "2026-03-08T12:00:00Z"),
});

describe("the overview's rows", () => {
	const selected = { startDate: "2026-03-02", endDate: "2026-03-08", cadence: "weekly" as const };
	const afterPeriod = parseInstant("2026-03-09T09:00:00Z");
	const employee = (
		name: string,
		submissions: OverviewSubmission[] = [],
		expected: ExpectedSubmissionPeriod[] = [week("2026-03-02", "2026-03-08")],
	) => ({ employeeId: `id-${name}`, name, expected, submissions });

	const statuses = (rows: ReturnType<typeof buildOverviewRows>["rows"]) =>
		Object.fromEntries(rows.map((row) => [row.name, row.status]));

	it("lists only the employees expected to submit the selected period", () => {
		const { rows } = buildOverviewRows({
			selected,
			now: afterPeriod,
			employees: [
				employee("Expected"),
				employee("Not expected", [], []),
				employee(
					"Other period only",
					[],
					[
						{
							...week("2026-03-09", "2026-03-15"),
							cadenceStartDate: parsePlainDate("2026-03-09"),
							cadenceEndDate: parsePlainDate("2026-03-15"),
						},
					],
				),
			],
		});
		expect(rows.map((row) => row.name)).toEqual(["Expected"]);
	});

	it("shows each employee's status from their latest submission of the period", () => {
		const { rows, counts } = buildOverviewRows({
			selected,
			now: afterPeriod,
			employees: [
				employee("Awaiting"),
				employee("Pending", [submitted("pending")]),
				employee("Approved", [submitted("approved")]),
				employee("Rejected", [submitted("rejected")]),
				employee("Withdrawn", [submitted("withdrawn", { closedCause: "employee" })]),
				employee("Outdated", [submitted("outdated", { closedCause: "change" })]),
				employee("Auto withdrawn", [submitted("withdrawn", { closedCause: "change" })]),
				employee("Resubmitted", [
					submitted("pending", { submittedAt: "2026-03-09T08:00:00Z" }),
					submitted("outdated", { closedCause: "change", submittedAt: "2026-03-08T12:00:00Z" }),
				]),
			],
		});
		expect(statuses(rows)).toEqual({
			Awaiting: "awaiting_submission",
			Pending: "submitted",
			Approved: "approved",
			Rejected: "rejected",
			Withdrawn: "awaiting_submission",
			Outdated: "sent_back_after_change",
			"Auto withdrawn": "sent_back_after_change",
			Resubmitted: "submitted",
		});
		expect(counts).toEqual({
			awaiting_submission: 2,
			submitted: 2,
			approved: 1,
			rejected: 1,
			sent_back_after_change: 2,
		});
	});

	it("ignores a submission of another range than the employee's expected period", () => {
		const { rows } = buildOverviewRows({
			selected,
			now: afterPeriod,
			employees: [employee("Moved start", [submitted("approved", { startDate: "2026-03-04" })])],
		});
		expect(statuses(rows)).toEqual({ "Moved start": "awaiting_submission" });
	});

	it("highlights employees who owe the period once its last day has come, listing them first", () => {
		const employees = [
			employee("Anna", [submitted("approved")]),
			employee("Bert"),
			employee("Cleo", [submitted("rejected")]),
			employee("Dora", [submitted("pending")]),
			employee("Emil", [submitted("outdated", { closedCause: "change" })]),
		];
		const after = buildOverviewRows({ selected, now: afterPeriod, employees }).rows;
		expect(after.map((row) => [row.name, row.highlighted])).toEqual([
			["Bert", true],
			["Cleo", true],
			["Emil", true],
			["Anna", false],
			["Dora", false],
		]);

		// On the last day, in the employee's zone, submitting is open.
		const lastDay = buildOverviewRows({
			selected,
			now: parseInstant("2026-03-07T23:30:00Z"),
			employees: [
				employee("Berlin"),
				employee("New York", [], [week("2026-03-02", "2026-03-08", "America/New_York")]),
			],
		}).rows;
		expect(lastDay.map((row) => [row.name, row.highlighted, row.opensOn])).toEqual([
			["Berlin", true, "2026-03-08"],
			["New York", false, "2026-03-08"],
		]);
	});

	it("shows a submitted period's own range and the expected range otherwise", () => {
		const { rows } = buildOverviewRows({
			selected,
			now: afterPeriod,
			employees: [
				employee("Hired midweek", [], [week("2026-03-04", "2026-03-08")]),
				employee("Submitted", [submitted("pending")]),
			],
		});
		expect(rows.map((row) => [row.name, row.startDate, row.endDate, row.submittedAt])).toEqual([
			["Hired midweek", "2026-03-04", "2026-03-08", null],
			["Submitted", "2026-03-02", "2026-03-08", "2026-03-08T12:00:00.000Z"],
		]);
	});
});
