import { describe, expect, it } from "vitest";
import type { SharedBillableFigures } from "@/lib/billable-time/report-figures";
import { exportReportDocumentToCSV } from "@/lib/reports/exporters/report-document-csv";
import { DEFAULT_PROJECT_REPORT_EXPORT_LABELS } from "@/lib/reports/project-report-export";
import type { SharedCustomerSnapshot, SharedProjectSnapshot } from "./shared-snapshot";
import { buildSharedSnapshotDocument } from "./shared-snapshot-document";

const context = {
	labels: DEFAULT_PROJECT_REPORT_EXPORT_LABELS,
	generatedAt: "2026-05-02 10:00",
};

const withRevenue: SharedBillableFigures = {
	access: "shared",
	currency: "EUR",
	billableMinutes: 420,
	billableHours: 7,
	nonBillableMinutes: 60,
	nonBillableHours: 1,
	revenue: "740.00",
};
const { revenue: _revenue, ...hoursOnly } = withRevenue;

function projectSnapshot(
	billable: SharedBillableFigures,
	employees: SharedProjectSnapshot["employeeBreakdown"] = [],
): SharedProjectSnapshot {
	return {
		kind: "project",
		project: { name: "Website", customer: { name: "Acme" } },
		period: { startDate: "2026-03-01", endDate: "2026-04-30" },
		summary: { totalMinutes: 480, workPeriodCount: 4, billable },
		employeeBreakdown: employees,
		timeSeries: [{ date: "2026-03-01", hours: 8 }],
		...(billable.revenue
			? { billableTime: { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" } }
			: {}),
	};
}

function header(csv: string, table: string) {
	const lines = csv.split(/\r?\n/);
	return lines[lines.indexOf(table) + 1] ?? "";
}

describe("shared snapshot document", () => {
	it("renders hours, the billable split and revenue, and no internal figure column", () => {
		const csv = exportReportDocumentToCSV(
			buildSharedSnapshotDocument(projectSnapshot(withRevenue), context),
		);

		expect(header(csv, "Summary")).toBe(
			"Project,Hours,Work periods,Billable hours,Non-billable hours,Revenue (EUR)",
		);
		expect(csv).toContain("740.00");
		expect(csv).not.toMatch(/cost|margin|unpriced|pending|invoiced|without customer/i);
	});

	it("has no revenue column, currency or rate notes when the snapshot shares hours only", () => {
		const csv = exportReportDocumentToCSV(
			buildSharedSnapshotDocument(projectSnapshot(hoursOnly), context),
		);

		expect(header(csv, "Summary")).toBe(
			"Project,Hours,Work periods,Billable hours,Non-billable hours",
		);
		expect(csv).not.toMatch(/revenue|currency|rates/i);
	});

	it("leaves out the employee table unless the snapshot has the employee breakdown", () => {
		const without = buildSharedSnapshotDocument(projectSnapshot(withRevenue), context);
		const withEmployees = buildSharedSnapshotDocument(
			projectSnapshot(withRevenue, [
				{
					employeeName: "Robin Worker",
					totalMinutes: 480,
					workPeriodCount: 4,
					billable: withRevenue,
				},
			]),
			context,
		);

		expect(without.tables.map((table) => table.title)).not.toContain("Employees");
		expect(exportReportDocumentToCSV(withEmployees)).toContain("Robin Worker");
	});

	it("renders one customer and its projects", () => {
		const snapshot: SharedCustomerSnapshot = {
			kind: "customer",
			period: { startDate: "2026-03-01", endDate: "2026-04-30" },
			customer: {
				customer: { name: "Acme" },
				totalMinutes: 480,
				workPeriodCount: 4,
				billable: withRevenue,
				projects: [
					{
						project: { name: "Website" },
						totalMinutes: 480,
						workPeriodCount: 4,
						billable: withRevenue,
					},
				],
			},
			billableTime: { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" },
		};
		const document = buildSharedSnapshotDocument(snapshot, context);
		const csv = exportReportDocumentToCSV(document);

		expect(document.title).toBe("Customer report");
		expect(header(csv, "Projects")).toBe(
			"Customer,Project,Hours,Work periods,Billable hours,Non-billable hours,Revenue (EUR)",
		);
		expect(csv).toContain("Acme,Website,8.00");
		expect(csv).not.toMatch(/cost|margin|unpriced|pending|without customer/i);
	});
});
