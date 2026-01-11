/**
 * Tests for Vacation Service
 *
 * Tests vacation balance calculations, carryover logic, expiry enforcement,
 * and accrual calculations.
 */

import { describe, expect, mock, test } from "bun:test";

// Mock the database module
const mockQuery = mock(() => ({
	employee: {
		findFirst: mock(() => Promise.resolve(null)),
		findMany: mock(() => Promise.resolve([])),
	},
	vacationAllowance: {
		findFirst: mock(() => Promise.resolve(null)),
		findMany: mock(() => Promise.resolve([])),
	},
	employeeVacationAllowance: {
		findFirst: mock(() => Promise.resolve(null)),
	},
}));

const mockInsert = mock(() => ({
	values: mock(() => Promise.resolve()),
}));

const mockUpdate = mock(() => ({
	set: mock(() => ({
		where: mock(() => ({
			returning: mock(() => Promise.resolve([])),
		})),
	})),
}));

mock.module("@/db", () => ({
	db: {
		query: mockQuery(),
		insert: mockInsert,
		update: mockUpdate,
		select: mock(() => ({
			from: mock(() => ({
				innerJoin: mock(() => ({
					where: mock(() => Promise.resolve([])),
				})),
				where: mock(() => Promise.resolve([])),
			})),
		})),
	},
}));

mock.module("@/db/schema", () => ({
	employee: { id: "employee", organizationId: "organization_id" },
	employeeVacationAllowance: { id: "employee_vacation_allowance" },
	vacationAllowance: { id: "vacation_allowance" },
	absenceEntry: { id: "absence_entry" },
	absenceCategory: { id: "absence_category" },
}));

// Mock the logger
mock.module("@/lib/logger", () => ({
	createLogger: () => ({
		info: mock(() => {}),
		error: mock(() => {}),
		warn: mock(() => {}),
	}),
}));

// Mock the audit logger
mock.module("@/lib/audit-logger", () => ({
	logAudit: mock(() => Promise.resolve()),
	AuditAction: {
		VACATION_CARRYOVER_APPLIED: "vacation.carryover_applied",
		VACATION_CARRYOVER_EXPIRED: "vacation.carryover_expired",
		VACATION_ALLOWANCE_UPDATED: "vacation.allowance_updated",
	},
}));

describe("Vacation Calculator", () => {
	describe("calculateVacationBalance", () => {
		test("should calculate basic balance without carryover", async () => {
			const { calculateVacationBalance } = await import("../vacation-calculator");

			const result = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					allowCarryover: false,
					maxCarryoverDays: null,
					carryoverExpiryMonths: null,
				},
				employeeAllowance: null,
				absences: [],
				currentDate: new Date(),
				year: 2024,
			});

			expect(result.totalDays).toBe(30);
			expect(result.usedDays).toBe(0);
			expect(result.remainingDays).toBe(30);
			expect(result.carryoverDays).toBeUndefined();
		});

		test("should apply custom annual days from employee allowance", async () => {
			const { calculateVacationBalance } = await import("../vacation-calculator");

			const result = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					allowCarryover: false,
					maxCarryoverDays: null,
					carryoverExpiryMonths: null,
				},
				employeeAllowance: {
					customAnnualDays: "35",
					customCarryoverDays: null,
					adjustmentDays: "0",
				},
				absences: [],
				currentDate: new Date(),
				year: 2024,
			});

			expect(result.totalDays).toBe(35);
		});

		test("should add adjustment days", async () => {
			const { calculateVacationBalance } = await import("../vacation-calculator");

			const result = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					allowCarryover: false,
					maxCarryoverDays: null,
					carryoverExpiryMonths: null,
				},
				employeeAllowance: {
					customAnnualDays: null,
					customCarryoverDays: null,
					adjustmentDays: "5",
				},
				absences: [],
				currentDate: new Date(),
				year: 2024,
			});

			expect(result.totalDays).toBe(35);
		});

		test("should include carryover days when allowed and not expired", async () => {
			const { calculateVacationBalance } = await import("../vacation-calculator");

			// Set current date to January 15, 2024 (before March expiry)
			const currentDate = new Date(2024, 0, 15);

			const result = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					allowCarryover: true,
					maxCarryoverDays: "10",
					carryoverExpiryMonths: 3, // Expires end of March
				},
				employeeAllowance: {
					customAnnualDays: null,
					customCarryoverDays: "5",
					adjustmentDays: "0",
				},
				absences: [],
				currentDate,
				year: 2024,
			});

			expect(result.totalDays).toBe(35); // 30 + 5 carryover
			expect(result.carryoverDays).toBe(5);
			expect(result.carryoverExpiryDate).toBeDefined();
		});

		test("should exclude expired carryover", async () => {
			const { calculateVacationBalance } = await import("../vacation-calculator");

			// Set current date to April 15, 2024 (after March expiry)
			const currentDate = new Date(2024, 3, 15);

			const result = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					allowCarryover: true,
					maxCarryoverDays: "10",
					carryoverExpiryMonths: 3, // Expires end of March
				},
				employeeAllowance: {
					customAnnualDays: null,
					customCarryoverDays: "5",
					adjustmentDays: "0",
				},
				absences: [],
				currentDate,
				year: 2024,
			});

			expect(result.totalDays).toBe(30); // Carryover expired
			expect(result.carryoverDays).toBeUndefined();
		});

		test("should calculate used days from approved absences", async () => {
			const { calculateVacationBalance } = await import("../vacation-calculator");

			const result = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					allowCarryover: false,
					maxCarryoverDays: null,
					carryoverExpiryMonths: null,
				},
				employeeAllowance: null,
				absences: [
					{
						id: "absence-1",
						employeeId: "emp-1",
						startDate: new Date(2024, 5, 10),
						endDate: new Date(2024, 5, 14), // 5 days
						status: "approved",
						notes: null,
						category: {
							id: "vacation",
							name: "Vacation",
							type: "vacation",
							color: null,
							countsAgainstVacation: true,
						},
						approvedBy: null,
						approvedAt: null,
						rejectionReason: null,
						createdAt: new Date(),
					},
				],
				currentDate: new Date(2024, 6, 1),
				year: 2024,
			});

			expect(result.usedDays).toBe(5);
			expect(result.remainingDays).toBe(25);
		});

		test("should calculate pending days separately", async () => {
			const { calculateVacationBalance } = await import("../vacation-calculator");

			const result = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					allowCarryover: false,
					maxCarryoverDays: null,
					carryoverExpiryMonths: null,
				},
				employeeAllowance: null,
				absences: [
					{
						id: "absence-1",
						employeeId: "emp-1",
						startDate: new Date(2024, 7, 10),
						endDate: new Date(2024, 7, 12), // 3 days
						status: "pending",
						notes: null,
						category: {
							id: "vacation",
							name: "Vacation",
							type: "vacation",
							color: null,
							countsAgainstVacation: true,
						},
						approvedBy: null,
						approvedAt: null,
						rejectionReason: null,
						createdAt: new Date(),
					},
				],
				currentDate: new Date(2024, 6, 1),
				year: 2024,
			});

			expect(result.pendingDays).toBe(3);
			expect(result.remainingDays).toBe(27); // 30 - 0 used - 3 pending
		});
	});

	describe("hasSufficientBalance", () => {
		test("should return true when balance is sufficient", async () => {
			const { hasSufficientBalance } = await import("../vacation-calculator");

			const balance = {
				year: 2024,
				totalDays: 30,
				usedDays: 10,
				pendingDays: 5,
				remainingDays: 15,
			};

			expect(hasSufficientBalance(balance, 10)).toBe(true);
			expect(hasSufficientBalance(balance, 15)).toBe(true);
		});

		test("should return false when balance is insufficient", async () => {
			const { hasSufficientBalance } = await import("../vacation-calculator");

			const balance = {
				year: 2024,
				totalDays: 30,
				usedDays: 10,
				pendingDays: 5,
				remainingDays: 15,
			};

			expect(hasSufficientBalance(balance, 16)).toBe(false);
			expect(hasSufficientBalance(balance, 20)).toBe(false);
		});
	});

	describe("prorateAnnualDays", () => {
		test("should return full days for employees starting before year", async () => {
			const { prorateAnnualDays } = await import("../vacation-calculator");

			const result = prorateAnnualDays(30, new Date(2023, 5, 15), 2024);

			expect(result).toBe(30);
		});

		test("should prorate for mid-year start", async () => {
			const { prorateAnnualDays } = await import("../vacation-calculator");

			// Start July 1, 2024 - half year remaining
			const result = prorateAnnualDays(30, new Date(2024, 6, 1), 2024);

			// Approximately half the year remaining
			expect(result).toBeGreaterThan(14);
			expect(result).toBeLessThan(16);
		});

		test("should return 0 for future start date", async () => {
			const { prorateAnnualDays } = await import("../vacation-calculator");

			const result = prorateAnnualDays(30, new Date(2025, 0, 1), 2024);

			expect(result).toBe(0);
		});
	});
});

describe("Date Utils", () => {
	describe("calculateCarryoverExpiryDate", () => {
		test("should calculate expiry date correctly for 3 months", async () => {
			const { calculateCarryoverExpiryDate } = await import("../date-utils");

			const result = calculateCarryoverExpiryDate(2024, 3);

			// Should be March 31, 2024
			expect(result.month).toBe(3);
			expect(result.day).toBe(31);
			expect(result.year).toBe(2024);
		});

		test("should calculate expiry date correctly for 6 months", async () => {
			const { calculateCarryoverExpiryDate } = await import("../date-utils");

			const result = calculateCarryoverExpiryDate(2024, 6);

			// Should be June 30, 2024
			expect(result.month).toBe(6);
			expect(result.day).toBe(30);
			expect(result.year).toBe(2024);
		});
	});

	describe("calculateBusinessDays", () => {
		test("should count weekdays only", async () => {
			const { calculateBusinessDays } = await import("../date-utils");

			// Monday to Saturday = 5 business days (Mon, Tue, Wed, Thu, Fri)
			// Note: Luxon intervals are [start, end) exclusive of end
			const result = calculateBusinessDays(
				new Date(2024, 0, 8), // Monday
				new Date(2024, 0, 13), // Saturday (exclusive, so includes Fri)
				[],
			);

			expect(result).toBe(5);
		});

		test("should exclude weekends", async () => {
			const { calculateBusinessDays } = await import("../date-utils");

			// Monday to Tuesday = 6 business days (excludes Sat/Sun in between)
			// Note: Luxon intervals are [start, end) exclusive of end
			const result = calculateBusinessDays(
				new Date(2024, 0, 8), // Monday
				new Date(2024, 0, 16), // Tuesday (exclusive, so includes Mon)
				[],
			);

			expect(result).toBe(6);
		});

		test("should exclude holidays", async () => {
			const { calculateBusinessDays } = await import("../date-utils");

			const result = calculateBusinessDays(
				new Date(2024, 0, 8), // Monday
				new Date(2024, 0, 13), // Saturday (exclusive, includes Fri)
				[
					{
						id: "holiday-1",
						name: "Holiday",
						startDate: new Date(2024, 0, 10), // Wednesday
						endDate: new Date(2024, 0, 11), // Thu (exclusive, so includes Wed)
						categoryId: "cat-1",
					},
				],
			);

			expect(result).toBe(4); // 5 - 1 holiday
		});
	});

	describe("getYearRange", () => {
		test("should return correct year boundaries", async () => {
			const { getYearRange } = await import("../date-utils");

			const { start, end } = getYearRange(2024);

			expect(start.year).toBe(2024);
			expect(start.month).toBe(1);
			expect(start.day).toBe(1);

			expect(end.year).toBe(2024);
			expect(end.month).toBe(12);
			expect(end.day).toBe(31);
		});
	});

	describe("dateRangesOverlap", () => {
		test("should detect overlapping ranges", async () => {
			const { dateRangesOverlap } = await import("../date-utils");

			const result = dateRangesOverlap(
				new Date(2024, 0, 1),
				new Date(2024, 0, 10),
				new Date(2024, 0, 5),
				new Date(2024, 0, 15),
			);

			expect(result).toBe(true);
		});

		test("should detect non-overlapping ranges", async () => {
			const { dateRangesOverlap } = await import("../date-utils");

			const result = dateRangesOverlap(
				new Date(2024, 0, 1),
				new Date(2024, 0, 10),
				new Date(2024, 0, 15),
				new Date(2024, 0, 20),
			);

			expect(result).toBe(false);
		});

		test("should detect adjacent ranges as non-overlapping", async () => {
			const { dateRangesOverlap } = await import("../date-utils");

			const result = dateRangesOverlap(
				new Date(2024, 0, 1),
				new Date(2024, 0, 10),
				new Date(2024, 0, 11),
				new Date(2024, 0, 20),
			);

			expect(result).toBe(false);
		});
	});
});

describe("Vacation Reports", () => {
	describe("exportVacationBalanceAsCsv", () => {
		test("should generate valid CSV", async () => {
			const { exportVacationBalanceAsCsv } = await import("../../reporting/vacation-reports");

			const reports = [
				{
					employeeId: "emp-1",
					employeeName: "John Doe",
					email: "john@example.com",
					totalAllowance: 30,
					carryover: 5,
					adjustments: 2,
					used: 10,
					pending: 3,
					remaining: 24,
					carryoverExpiryDate: new Date(2024, 2, 31),
					utilizationRate: 43,
				},
			];

			const csv = exportVacationBalanceAsCsv(reports, 2024);

			expect(csv).toContain("Vacation Balance Report - 2024");
			expect(csv).toContain("John Doe");
			expect(csv).toContain("30.0");
			expect(csv).toContain("5.0");
			expect(csv).toContain("24.0");
			expect(csv).toContain("43%");
		});

		test("should include summary statistics", async () => {
			const { exportVacationBalanceAsCsv } = await import("../../reporting/vacation-reports");

			const reports = [
				{
					employeeId: "emp-1",
					employeeName: "John Doe",
					email: "john@example.com",
					totalAllowance: 30,
					carryover: 0,
					adjustments: 0,
					used: 10,
					pending: 0,
					remaining: 20,
					carryoverExpiryDate: null,
					utilizationRate: 33,
				},
				{
					employeeId: "emp-2",
					employeeName: "Jane Smith",
					email: "jane@example.com",
					totalAllowance: 30,
					carryover: 0,
					adjustments: 0,
					used: 15,
					pending: 5,
					remaining: 10,
					carryoverExpiryDate: null,
					utilizationRate: 67,
				},
			];

			const csv = exportVacationBalanceAsCsv(reports, 2024);

			expect(csv).toContain("Summary");
			expect(csv).toContain("Total Employees,2");
			expect(csv).toContain("Total Allowance,60.0");
			expect(csv).toContain("Total Used,25.0");
		});
	});

	describe("exportExpirationReportAsCsv", () => {
		test("should generate valid expiration CSV", async () => {
			const { exportExpirationReportAsCsv } = await import("../../reporting/vacation-reports");

			const reports = [
				{
					employeeId: "emp-1",
					employeeName: "John Doe",
					carryoverDays: 5,
					expiresAt: new Date(2024, 2, 31),
					daysUntilExpiry: 15,
					urgency: "warning" as const,
				},
			];

			const csv = exportExpirationReportAsCsv(reports);

			expect(csv).toContain("Carryover Expiration Report");
			expect(csv).toContain("John Doe");
			expect(csv).toContain("5.0");
			expect(csv).toContain("15");
			expect(csv).toContain("warning");
		});
	});

	describe("formatVacationBalanceAsHtml", () => {
		test("should generate valid HTML", async () => {
			const { formatVacationBalanceAsHtml } = await import("../../reporting/vacation-reports");

			const reports = [
				{
					employeeId: "emp-1",
					employeeName: "John Doe",
					email: "john@example.com",
					totalAllowance: 30,
					carryover: 0,
					adjustments: 0,
					used: 10,
					pending: 5,
					remaining: 15,
					carryoverExpiryDate: null,
					utilizationRate: 50,
				},
			];

			const html = formatVacationBalanceAsHtml(reports, 2024, "Test Organization");

			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain("Vacation Balance Report");
			expect(html).toContain("Test Organization");
			expect(html).toContain("John Doe");
			expect(html).toContain("</html>");
		});

		test("should highlight low balance employees", async () => {
			const { formatVacationBalanceAsHtml } = await import("../../reporting/vacation-reports");

			const reports = [
				{
					employeeId: "emp-1",
					employeeName: "Low Balance Employee",
					email: "low@example.com",
					totalAllowance: 30,
					carryover: 0,
					adjustments: 0,
					used: 28,
					pending: 0,
					remaining: 2, // Low balance
					carryoverExpiryDate: null,
					utilizationRate: 93,
				},
			];

			const html = formatVacationBalanceAsHtml(reports, 2024, "Test Organization");

			expect(html).toContain("low-balance");
		});
	});
});
