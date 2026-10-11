import { describe, expect, it } from "vitest";
import type { BillableFigures } from "@/lib/billable-time/report-figures";
import type { CustomerBillableReport, ProjectDetailedReport } from "@/lib/reports/project-types";
import { takeCustomerSnapshot, takeProjectSnapshot } from "./shared-snapshot";

// An owner's figures: everything Billable Time knows, including what a
// shared snapshot must never carry.
const ownerFigures: BillableFigures = {
	access: "full",
	currency: "EUR",
	billableMinutes: 420,
	billableHours: 7,
	nonBillableMinutes: 60,
	nonBillableHours: 1,
	withoutCustomerMinutes: 30,
	withoutCustomerHours: 0.5,
	withoutCustomerWorkCount: 1,
	unpricedWorkCount: 3,
	unpricedHours: 1.5,
	pendingReviewCount: 2,
	revenue: "740.00",
	cost: "350.00",
	margin: "390.00",
	marginPercent: "52.7",
	costUnknownWorkCount: 1,
	invoicing: {
		invoicedMinutes: 300,
		invoicedHours: 5,
		invoicedRevenue: "500.00",
		uninvoicedMinutes: 120,
		uninvoicedHours: 2,
		uninvoicedRevenue: "240.00",
		changedAfterInvoicingCount: 1,
	},
};

const INTERNAL_FIGURE_KEYS = [
	"cost",
	"margin",
	"marginPercent",
	"costUnknownWorkCount",
	"unpricedWorkCount",
	"unpricedHours",
	"pendingReviewCount",
	"withoutCustomerMinutes",
	"withoutCustomerHours",
	"withoutCustomerWorkCount",
	"invoicing",
];

function keysDeep(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(keysDeep);
	if (value && typeof value === "object") {
		return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
	}
	return [];
}

function projectReport(): ProjectDetailedReport {
	return {
		project: {
			id: "p1",
			name: "Website",
			description: "Internal notes about the website",
			status: "active",
			color: "#ff0000",
			budgetHours: 100,
			deadline: null,
			customer: { id: "c1", name: "Acme", customFields: [] },
			customFields: [],
		},
		period: {
			startDate: "2026-03-01T00:00:00.000Z",
			endDate: "2026-04-30T00:00:00.000Z",
			label: "",
		},
		summary: {
			totalHours: 8,
			totalMinutes: 480,
			budgetHours: 100,
			percentBudgetUsed: 8,
			remainingBudgetHours: 92,
			uniqueEmployees: 1,
			workPeriodCount: 4,
			averageHoursPerDay: 0.13,
			billable: ownerFigures,
		},
		timeSeries: [{ date: "2026-03-01", hours: 8, cumulativeHours: 8 }],
		teamBreakdown: [
			{
				teamId: "t1",
				teamName: "Web team",
				totalHours: 8,
				totalMinutes: 480,
				percentOfTotal: 100,
				members: [],
			},
		],
		employeeBreakdown: [
			{
				employeeId: "e1",
				employeeName: "Robin Worker",
				totalHours: 8,
				totalMinutes: 480,
				workPeriodCount: 4,
				percentOfTotal: 100,
				billable: ownerFigures,
			},
		],
		billableTime: { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" },
		taskBreakdown: [],
	};
}

describe("shared snapshot of a project report", () => {
	it("never carries cost, margin, unpriced or pending figures, even from an owner's report", () => {
		const snapshot = takeProjectSnapshot(projectReport(), {
			figures: "revenue",
			includeEmployees: true,
		});

		const keys = keysDeep(snapshot);
		for (const key of INTERNAL_FIGURE_KEYS) expect(keys).not.toContain(key);
		expect(snapshot.summary.billable).toEqual({
			access: "shared",
			currency: "EUR",
			billableMinutes: 420,
			billableHours: 7,
			nonBillableMinutes: 60,
			nonBillableHours: 1,
			revenue: "740.00",
		});
	});

	it("shares hours and the billable split without revenue or currency when the link shares hours only", () => {
		const snapshot = takeProjectSnapshot(projectReport(), {
			figures: "hours",
			includeEmployees: true,
		});

		expect(keysDeep(snapshot)).not.toContain("revenue");
		expect(snapshot.billableTime).toBeUndefined();
		expect(snapshot.summary).toMatchObject({
			totalMinutes: 480,
			workPeriodCount: 4,
			billable: { billableMinutes: 420, nonBillableMinutes: 60 },
		});
	});

	it("holds no employee or team names while the employee breakdown is off", () => {
		const snapshot = takeProjectSnapshot(projectReport(), {
			figures: "revenue",
			includeEmployees: false,
		});

		const json = JSON.stringify(snapshot);
		expect(json).not.toContain("Robin Worker");
		expect(json).not.toContain("Web team");
		expect(snapshot.employeeBreakdown).toEqual([]);
	});

	it("shows real employee names when the creator switches the employee breakdown on", () => {
		const snapshot = takeProjectSnapshot(projectReport(), {
			figures: "revenue",
			includeEmployees: true,
		});

		expect(snapshot.employeeBreakdown).toEqual([
			{
				employeeName: "Robin Worker",
				totalMinutes: 480,
				workPeriodCount: 4,
				billable: expect.objectContaining({ access: "shared", revenue: "740.00" }),
			},
		]);
		expect(JSON.stringify(snapshot)).not.toContain("Web team");
	});

	it("keeps the period as calendar days and leaves out ids, budget and description", () => {
		const snapshot = takeProjectSnapshot(projectReport(), {
			figures: "revenue",
			includeEmployees: true,
		});

		expect(snapshot.period).toEqual({ startDate: "2026-03-01", endDate: "2026-04-30" });
		const json = JSON.stringify(snapshot);
		expect(json).not.toContain("Internal notes");
		const keys = keysDeep(snapshot);
		for (const key of ["id", "employeeId", "teamId", "budgetHours", "description"]) {
			expect(keys).not.toContain(key);
		}
	});
});

function projectSummary(name: string) {
	return {
		project: {
			id: `${name}-id`,
			name,
			description: null,
			status: "active" as const,
			color: null,
			budgetHours: null,
			deadline: null,
		},
		totalHours: 8,
		totalMinutes: 480,
		workPeriodCount: 4,
		billable: ownerFigures,
	};
}

function customerReport(): CustomerBillableReport {
	return {
		period: { startDate: "2026-03-01", endDate: "2026-04-30" },
		access: "full",
		billableTime: { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" },
		customers: [
			{
				customer: { id: "c1", name: "Acme" },
				totalHours: 16,
				totalMinutes: 960,
				workPeriodCount: 8,
				billable: ownerFigures,
				projects: [projectSummary("Website"), projectSummary("Support")],
			},
			{
				customer: { id: "c2", name: "Globex" },
				totalHours: 8,
				totalMinutes: 480,
				workPeriodCount: 4,
				billable: ownerFigures,
				projects: [projectSummary("Globex portal")],
			},
		],
		withoutCustomer: {
			totalHours: 8,
			totalMinutes: 480,
			workPeriodCount: 4,
			billable: ownerFigures,
			projects: [projectSummary("Internal tooling")],
		},
		totals: { totalHours: 32, totalMinutes: 1920, workPeriodCount: 16, billable: ownerFigures },
	};
}

describe("shared snapshot of one customer's billable report", () => {
	it("contains that customer and its projects only, never another customer or the without-customer group", () => {
		const snapshot = takeCustomerSnapshot(customerReport(), {
			customer: { id: "c1", name: "Acme" },
			figures: "revenue",
		});

		const json = JSON.stringify(snapshot);
		expect(json).not.toContain("Globex");
		expect(json).not.toContain("Internal tooling");
		expect(snapshot.customer).toMatchObject({
			customer: { name: "Acme" },
			totalMinutes: 960,
			workPeriodCount: 8,
			projects: [{ project: { name: "Website" } }, { project: { name: "Support" } }],
		});
		const keys = keysDeep(snapshot);
		for (const key of [...INTERNAL_FIGURE_KEYS, "id"]) expect(keys).not.toContain(key);
		expect(snapshot.customer.billable?.access).toBe("shared");
	});

	it("is an empty row for a customer without work in the period", () => {
		const snapshot = takeCustomerSnapshot(customerReport(), {
			customer: { id: "c9", name: "Initech" },
			figures: "hours",
		});

		expect(snapshot.customer).toEqual({
			customer: { name: "Initech" },
			totalMinutes: 0,
			workPeriodCount: 0,
			projects: [],
		});
	});
});
