/**
 * Shared snapshots (#806): the report content a report share link shows,
 * taken once from the creator's report when the link is created. Client-safe.
 *
 * A snapshot keeps report data, not rendered text, so the recipient page and
 * its downloads translate the labels when they are viewed. It is built field
 * by field from the creator's report: cost, margin, unpriced work, pending
 * reviews, work without customer, invoicing, ids, budgets and team names never
 * get in, whatever the creator's role.
 */

import {
	type BillableFigures,
	type SharedBillableFigures,
	sharedBillableFigures,
} from "@/lib/billable-time/report-figures";
import type {
	BillableTimeReportContext,
	CustomerBillableReport,
	ProjectDetailedReport,
} from "@/lib/reports/project-types";
import type { CustomFieldReportValue } from "@/lib/reports/types";

/** "hours": hours and the billable split; "revenue": also the revenue. */
export type ShareLinkFigures = "hours" | "revenue";

export interface SharedSnapshotOptions {
	figures: ShareLinkFigures;
}

/** The figures of one snapshot row. */
export interface SharedFigureRow {
	totalMinutes: number;
	workPeriodCount: number;
	billable?: SharedBillableFigures;
}

/** The report period, as calendar days (ISO dates), both inclusive. */
export interface SharedPeriod {
	startDate: string;
	endDate: string;
}

export interface SharedProjectSnapshot {
	kind: "project";
	project: {
		name: string;
		customer: { name: string; customFields?: CustomFieldReportValue[] } | null;
		customFields?: CustomFieldReportValue[];
	};
	period: SharedPeriod;
	summary: SharedFigureRow;
	/** Empty unless the creator switched the employee breakdown on. */
	employeeBreakdown: (SharedFigureRow & { employeeName: string })[];
	timeSeries: { date: string; hours: number }[];
	/** Only when the snapshot shares revenue. */
	billableTime?: BillableTimeReportContext;
}

export interface SharedCustomerSnapshot {
	kind: "customer";
	period: SharedPeriod;
	customer: SharedFigureRow & {
		customer: { name: string };
		projects: (SharedFigureRow & { project: { name: string } })[];
	};
	/** Only when the snapshot shares revenue. */
	billableTime?: BillableTimeReportContext;
}

export type SharedSnapshot = SharedProjectSnapshot | SharedCustomerSnapshot;

function sharedRow(
	row: { totalMinutes: number; workPeriodCount: number; billable?: BillableFigures },
	options: SharedSnapshotOptions,
): SharedFigureRow {
	return {
		totalMinutes: row.totalMinutes,
		workPeriodCount: row.workPeriodCount,
		...(row.billable
			? {
					billable: sharedBillableFigures(row.billable, { revenue: options.figures === "revenue" }),
				}
			: {}),
	};
}

function sharedBillableTime(
	billableTime: BillableTimeReportContext | undefined,
	options: SharedSnapshotOptions,
): { billableTime?: BillableTimeReportContext } {
	return billableTime && options.figures === "revenue"
		? {
				billableTime: {
					currency: billableTime.currency,
					ratesResolvedAt: billableTime.ratesResolvedAt,
				},
			}
		: {};
}

/**
 * A report period bound as a calendar day. The project report carries the
 * UTC midnight of the day (`readProjectDetailedReport`).
 */
function periodDay(bound: string): string {
	return /^\d{4}-\d{2}-\d{2}$/.test(bound) ? bound : bound.slice(0, 10);
}

/**
 * The shared snapshot of one customer's billable report. Only the named
 * customer's row and its projects are read; every other customer and the
 * without-customer group are left out even if the report carries them.
 */
export function takeCustomerSnapshot(
	report: CustomerBillableReport,
	options: SharedSnapshotOptions & { customer: { id: string; name: string } },
): SharedCustomerSnapshot {
	const row = report.customers.find((summary) => summary.customer.id === options.customer.id);
	return {
		kind: "customer",
		period: {
			startDate: periodDay(report.period.startDate),
			endDate: periodDay(report.period.endDate),
		},
		customer: row
			? {
					customer: { name: row.customer.name },
					...sharedRow(row, options),
					projects: row.projects.map((summary) => ({
						project: { name: summary.project.name },
						...sharedRow(summary, options),
					})),
				}
			: {
					customer: { name: options.customer.name },
					totalMinutes: 0,
					workPeriodCount: 0,
					projects: [],
				},
		...sharedBillableTime(report.billableTime, options),
	};
}

/** The shared snapshot of one project's detailed report. */
export function takeProjectSnapshot(
	report: ProjectDetailedReport,
	options: SharedSnapshotOptions & { includeEmployees: boolean },
): SharedProjectSnapshot {
	const customer = report.project.customer;
	return {
		kind: "project",
		project: {
			name: report.project.name,
			customer: customer
				? {
						name: customer.name,
						...(customer.customFields ? { customFields: customer.customFields } : {}),
					}
				: null,
			...(report.project.customFields ? { customFields: report.project.customFields } : {}),
		},
		period: {
			startDate: periodDay(report.period.startDate),
			endDate: periodDay(report.period.endDate),
		},
		summary: sharedRow(report.summary, options),
		employeeBreakdown: options.includeEmployees
			? report.employeeBreakdown.map((member) => ({
					employeeName: member.employeeName,
					...sharedRow(member, options),
				}))
			: [],
		timeSeries: report.timeSeries.map((point) => ({ date: point.date, hours: point.hours })),
		...sharedBillableTime(report.billableTime, options),
	};
}
