import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	timeRecordFindMany: vi.fn(),
	approvalRequestFindMany: vi.fn(),
	employeeFindMany: vi.fn(),
	employeeEmploymentHistoryFindMany: vi.fn(),
	payrollExportConfigFindMany: vi.fn(),
	payrollWageTypeMappingFindMany: vi.fn(),
	payrollExportJobFindMany: vi.fn(),
	travelExpenseClaimFindMany: vi.fn(),
}));

const operatorState = vi.hoisted(() => ({
	and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
	desc: vi.fn((column: unknown) => ({ op: "desc", column })),
	eq: vi.fn((column: unknown, value: unknown) => ({ op: "eq", column, value })),
	gte: vi.fn((column: unknown, value: unknown) => ({ op: "gte", column, value })),
	gt: vi.fn((column: unknown, value: unknown) => ({ op: "gt", column, value })),
	lte: vi.fn((column: unknown, value: unknown) => ({ op: "lte", column, value })),
	or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
	isNull: vi.fn((column: unknown) => ({ op: "isNull", column })),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
		op: "sql",
		strings: Array.from(strings),
		values,
	})),
}));

vi.mock("drizzle-orm", () => operatorState);

vi.mock("@/db", () => ({
	db: {
		query: {
			timeRecord: { findMany: mockState.timeRecordFindMany },
			approvalRequest: { findMany: mockState.approvalRequestFindMany },
			employee: { findMany: mockState.employeeFindMany },
			employeeEmploymentHistory: { findMany: mockState.employeeEmploymentHistoryFindMany },
			payrollExportConfig: { findMany: mockState.payrollExportConfigFindMany },
			payrollWageTypeMapping: { findMany: mockState.payrollWageTypeMappingFindMany },
			payrollExportJob: { findMany: mockState.payrollExportJobFindMany },
			travelExpenseClaim: { findMany: mockState.travelExpenseClaimFindMany },
		},
	},
	timeRecord: {
		organizationId: "time-record.organizationId",
		employeeId: "time-record.employeeId",
		recordKind: "time-record.recordKind",
		approvalState: "time-record.approvalState",
		startAt: "time-record.startAt",
		endAt: "time-record.endAt",
	},
	approvalRequest: {
		organizationId: "approval-request.organizationId",
		status: "approval-request.status",
	},
	employee: {
		organizationId: "employee.organizationId",
		legalEntityId: "employee.legalEntityId",
		isActive: "employee.isActive",
	},
	employeeEmploymentHistory: {
		employeeId: "employee-employment-history.employeeId",
		organizationId: "employee-employment-history.organizationId",
		legalEntityId: "employee-employment-history.legalEntityId",
		reviewState: "employee-employment-history.reviewState",
		validFrom: "employee-employment-history.validFrom",
		validUntil: "employee-employment-history.validUntil",
	},
	payrollExportConfig: {
		organizationId: "payroll-export-config.organizationId",
		legalEntityId: "payroll-export-config.legalEntityId",
		isActive: "payroll-export-config.isActive",
	},
	payrollWageTypeMapping: {
		isActive: "payroll-wage-type-mapping.isActive",
	},
	payrollExportJob: {
		organizationId: "payroll-export-job.organizationId",
		legalEntityId: "payroll-export-job.legalEntityId",
		filters: "payroll-export-job.filters",
		createdAt: "payroll-export-job.createdAt",
	},
	travelExpenseClaim: {
		organizationId: "travel-expense-claim.organizationId",
		legalEntityId: "travel-expense-claim.legalEntityId",
		status: "travel-expense-claim.status",
		tripStart: "travel-expense-claim.tripStart",
		tripEnd: "travel-expense-claim.tripEnd",
	},
}));

vi.mock("@/db/schema", () => ({
	employeeEmploymentHistory: {
		employeeId: "employee-employment-history.employeeId",
		organizationId: "employee-employment-history.organizationId",
		legalEntityId: "employee-employment-history.legalEntityId",
		reviewState: "employee-employment-history.reviewState",
		validFrom: "employee-employment-history.validFrom",
		validUntil: "employee-employment-history.validUntil",
	},
	travelExpenseClaim: {
		organizationId: "travel-expense-claim.organizationId",
		legalEntityId: "travel-expense-claim.legalEntityId",
		status: "travel-expense-claim.status",
		tripStart: "travel-expense-claim.tripStart",
		tripEnd: "travel-expense-claim.tripEnd",
	},
}));

import { derivePayrollReadinessStatus, getPayrollReadiness } from "./get-payroll-readiness";

const period = {
	start: DateTime.fromISO("2026-04-01T08:00:00.000Z"),
	end: DateTime.fromISO("2026-04-30T17:00:00.000Z"),
};

function defaultInput() {
	return {
		organizationId: "org-1",
		legalEntityId: "entity-a",
		period,
		now: DateTime.fromISO("2026-04-28T12:00:00.000Z"),
	};
}

function mockReadyQueries() {
	mockState.timeRecordFindMany.mockResolvedValue([]);
	mockState.approvalRequestFindMany.mockResolvedValue([]);
	mockState.employeeFindMany.mockResolvedValue([]);
	mockState.employeeEmploymentHistoryFindMany.mockResolvedValue([]);
	mockState.payrollExportConfigFindMany.mockResolvedValue([{ id: "config-1" }]);
	mockState.payrollWageTypeMappingFindMany.mockResolvedValue([{ id: "mapping-1" }]);
	mockState.payrollExportJobFindMany.mockResolvedValue([
		{
			id: "job-1",
			status: "completed",
			filters: {
				dateRange: { start: "2026-04-01T00:00:00.000Z", end: "2026-04-30T23:59:59.999Z" },
			},
		},
	]);
	mockState.travelExpenseClaimFindMany.mockResolvedValue([]);
}

function getCheck(result: Awaited<ReturnType<typeof getPayrollReadiness>>, id: string) {
	const check = result.groups.flatMap((group) => group.checks).find((item) => item.id === id);
	expect(check).toBeDefined();
	return check!;
}

describe("getPayrollReadiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReadyQueries();
	});

	it("returns ready when required checks pass", async () => {
		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(result.summary).toMatchObject({
			blockerCount: 0,
			warningCount: 0,
			affectedEmployeeCount: 0,
			configuredExportTargetCount: 1,
		});
		expect(getCheck(result, "pending-approvals")).toMatchObject({ status: "pass", count: 0 });
		expect(getCheck(result, "payroll-export-targets")).toMatchObject({ status: "pass", count: 1 });
		expect(getCheck(result, "wage-type-mappings")).toMatchObject({ status: "pass", count: 1 });
		expect(getCheck(result, "latest-payroll-export")).toMatchObject({ status: "pass", count: 1 });

		for (const findMany of [
			mockState.timeRecordFindMany,
			mockState.employeeFindMany,
			mockState.employeeEmploymentHistoryFindMany,
			mockState.payrollExportConfigFindMany,
			mockState.payrollExportJobFindMany,
			mockState.travelExpenseClaimFindMany,
		]) {
			expect(JSON.stringify(findMany.mock.calls[0]?.[0]?.where)).toContain("org-1");
			expect(JSON.stringify(findMany.mock.calls[0]?.[0]?.where)).toContain("entity-a");
		}
	});

	it("does not treat another legal entity's config as ready", async () => {
		mockState.payrollExportConfigFindMany.mockResolvedValue([]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(getCheck(result, "payroll-export-targets")).toMatchObject({
			status: "fail",
			count: 0,
		});
		expect(JSON.stringify(mockState.payrollExportConfigFindMany.mock.calls[0]?.[0]?.where)).toContain(
			"entity-a",
		);
	});

	it("blocks for pending approval records", async () => {
		mockState.timeRecordFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
			{
				id: "record-1",
				employeeId: "employee-1",
				startAt: new Date("2026-04-15T08:00:00.000Z"),
				employee: {
					id: "employee-1",
					employeeNumber: "E-1001",
					user: { name: "Ada Lovelace", email: "ada@example.com" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(result.summary.blockerCount).toBe(1);
		expect(result.summary.affectedEmployeeCount).toBe(1);
		expect(getCheck(result, "pending-approvals")).toMatchObject({
			status: "fail",
			severity: "blocker",
			count: 1,
			actionHref: "/approvals/inbox",
			affectedEmployees: [
				{
					id: "employee-1",
					name: "Ada Lovelace",
					email: "ada@example.com",
					employeeNumber: "E-1001",
				},
			],
		});
	});

	it("does not block for out-of-period active records when pending approval records query is empty", async () => {
		mockState.timeRecordFindMany
			.mockResolvedValueOnce([
				{
					id: "active-out-of-period",
					employeeId: "employee-1",
					startAt: new Date("2026-03-31T08:00:00.000Z"),
					employee: {
						id: "employee-1",
						employeeNumber: "E-1001",
						user: { name: "Ada Lovelace", email: "ada@example.com" },
					},
				},
			])
			.mockResolvedValueOnce([]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(getCheck(result, "pending-approvals")).toMatchObject({
			status: "pass",
			count: 0,
			affectedEmployees: [],
		});
	});

	it("blocks for pending approval records inside the selected period", async () => {
		mockState.timeRecordFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
			{
				id: "record-1",
				employeeId: "employee-1",
				startAt: new Date("2026-04-30T08:00:00.000Z"),
				employee: {
					id: "employee-1",
					employeeNumber: "E-1001",
					user: { name: "Ada Lovelace", email: "ada@example.com" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(getCheck(result, "pending-approvals")).toMatchObject({
			status: "fail",
			severity: "blocker",
			count: 1,
		});
		expect(JSON.stringify(mockState.timeRecordFindMany.mock.calls[1]?.[0]?.where)).toContain(
			"time-record.approvalState",
		);
		expect(JSON.stringify(mockState.timeRecordFindMany.mock.calls[1]?.[0]?.where)).toContain(
			"pending",
		);
	});

	it("treats stale active work periods as warning-only", async () => {
		mockState.timeRecordFindMany
			.mockResolvedValueOnce([
				{ id: "recent", employeeId: "employee-1", startAt: new Date("2026-04-28T08:00:00.000Z") },
				{
					id: "stale",
					employeeId: "employee-2",
					startAt: new Date("2026-04-27T10:00:00.000Z"),
					employee: {
						id: "employee-2",
						employeeNumber: "E-1002",
						user: { name: "Grace Hopper", email: "grace@example.com" },
					},
				},
			])
			.mockResolvedValueOnce([]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(result.summary.warningCount).toBe(1);
		expect(getCheck(result, "stale-active-work")).toMatchObject({
			status: "warning",
			severity: "warning",
			count: 1,
			actionHref: "/time-tracking",
			affectedEmployees: [
				{
					id: "employee-2",
					name: "Grace Hopper",
					email: "grace@example.com",
					employeeNumber: "E-1002",
				},
			],
		});
	});

	it("blocks when no payroll export target is configured", async () => {
		mockState.payrollExportConfigFindMany.mockResolvedValue([]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(result.summary.blockerCount).toBe(2);
		expect(result.summary.configuredExportTargetCount).toBe(0);
		expect(getCheck(result, "payroll-export-targets")).toMatchObject({
			status: "fail",
			severity: "blocker",
			count: 0,
			actionHref: "/settings/payroll-export",
		});
	});

	it("warns when active employees lack confirmed employment history for the selected period", async () => {
		mockState.employeeFindMany.mockResolvedValue([
			{
				id: "employee-1",
				employeeNumber: "EMP-1",
				user: { name: "Ada Lovelace", email: "ada@example.com" },
			},
			{
				id: "employee-2",
				employeeNumber: "EMP-2",
				user: { name: "Grace Hopper", email: "grace@example.com" },
			},
		]);
		mockState.employeeEmploymentHistoryFindMany.mockResolvedValue([
			{ id: "history-1", employeeId: "employee-2" },
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(result.summary.warningCount).toBe(1);
		expect(result.summary.affectedEmployeeCount).toBe(1);
		expect(getCheck(result, "missing-employment-history")).toMatchObject({
			group: "payrollSetup",
			title: "Employment history coverage",
			status: "warning",
			severity: "warning",
			count: 1,
			actionHref: "/settings/employees",
			actionLabel: "Review employees",
			affectedEmployees: [
				{
					id: "employee-1",
					name: "Ada Lovelace",
					email: "ada@example.com",
					employeeNumber: "EMP-1",
				},
			],
		});
		expect(JSON.stringify(mockState.employeeFindMany.mock.calls[0]?.[0]?.where)).toContain("org-1");
		expect(
			JSON.stringify(mockState.employeeEmploymentHistoryFindMany.mock.calls[0]?.[0]?.where),
		).toContain("org-1");
		expect(
			JSON.stringify(mockState.employeeEmploymentHistoryFindMany.mock.calls[0]?.[0]?.where),
		).toContain("confirmed");
		expect(
			JSON.stringify(mockState.employeeEmploymentHistoryFindMany.mock.calls[0]?.[0]?.where),
		).toContain("lte");
		expect(
			JSON.stringify(mockState.employeeEmploymentHistoryFindMany.mock.calls[0]?.[0]?.where),
		).toContain("gt");
	});

	it("does not pass wage mappings from global data when no org export target exists", async () => {
		mockState.payrollExportConfigFindMany.mockResolvedValue([]);
		mockState.payrollWageTypeMappingFindMany.mockResolvedValue([{ id: "other-org-mapping" }]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(getCheck(result, "wage-type-mappings")).toMatchObject({
			status: "fail",
			severity: "blocker",
		});
		expect(mockState.payrollWageTypeMappingFindMany).not.toHaveBeenCalled();
	});

	it("blocks when no wage type mappings are configured", async () => {
		mockState.payrollWageTypeMappingFindMany.mockResolvedValue([]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(getCheck(result, "wage-type-mappings")).toMatchObject({
			status: "fail",
			severity: "blocker",
		});
	});

	it("blocks when latest payroll export failed", async () => {
		mockState.payrollExportJobFindMany.mockResolvedValue([
			{
				id: "job-1",
				status: "failed",
				filters: {
					dateRange: { start: "2026-04-01T00:00:00.000Z", end: "2026-04-30T23:59:59.999Z" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(result.summary.blockerCount).toBe(1);
		expect(getCheck(result, "latest-payroll-export")).toMatchObject({
			status: "fail",
			severity: "blocker",
			count: 1,
			actionHref: "/settings/payroll-export",
		});
	});

	it("does not block when the latest failed payroll export is for a different period", async () => {
		mockState.payrollExportJobFindMany.mockResolvedValue([
			{
				id: "job-1",
				status: "failed",
				filters: {
					dateRange: { start: "2026-03-01T00:00:00.000Z", end: "2026-03-31T23:59:59.999Z" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(getCheck(result, "latest-payroll-export")).toMatchObject({
			status: "pass",
			count: 0,
		});
		expect(JSON.stringify(mockState.payrollExportJobFindMany.mock.calls[0]?.[0]?.where)).toContain(
			"2026-04-01",
		);
		expect(JSON.stringify(mockState.payrollExportJobFindMany.mock.calls[0]?.[0]?.where)).toContain(
			"2026-04-30",
		);
		expect(JSON.stringify(mockState.payrollExportJobFindMany.mock.calls[0]?.[0]?.where)).toContain(
			"left(",
		);
		expect(mockState.payrollExportJobFindMany.mock.calls[0]?.[0]?.limit).toBe(1);
	});

	it("blocks when the most recent payroll export for the selected period failed", async () => {
		mockState.payrollExportJobFindMany.mockResolvedValue([
			{
				id: "newer-other-period",
				status: "completed",
				filters: {
					dateRange: { start: "2026-05-01T00:00:00.000Z", end: "2026-05-31T23:59:59.999Z" },
				},
			},
			{
				id: "selected-period-failed",
				status: "failed",
				filters: {
					dateRange: { start: "2026-04-01T00:00:00.000Z", end: "2026-04-30T23:59:59.999Z" },
				},
			},
			{
				id: "selected-period-completed",
				status: "completed",
				filters: {
					dateRange: { start: "2026-04-01T00:00:00.000Z", end: "2026-04-30T23:59:59.999Z" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("blocked");
		expect(getCheck(result, "latest-payroll-export")).toMatchObject({
			status: "fail",
			severity: "blocker",
			count: 1,
		});
	});

	it("treats travel expense issues as warning-only", async () => {
		mockState.travelExpenseClaimFindMany.mockResolvedValue([
			{
				id: "claim-1",
				employeeId: "employee-1",
				employee: {
					id: "employee-1",
					employeeNumber: "E-1003",
					user: { name: "Katherine Johnson", email: "kat@example.com" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(result.summary.warningCount).toBe(1);
		expect(result.summary.affectedEmployeeCount).toBe(1);
		expect(getCheck(result, "travel-expense-warnings")).toMatchObject({
			status: "warning",
			severity: "warning",
			count: 1,
			actionHref: "/travel-expenses/approvals",
			affectedEmployees: [
				{
					id: "employee-1",
					name: "Katherine Johnson",
					email: "kat@example.com",
					employeeNumber: "E-1003",
				},
			],
		});
	});

	it("treats travel claims overlapping the selected period as warning-only", async () => {
		mockState.travelExpenseClaimFindMany.mockResolvedValue([
			{
				id: "claim-1",
				employeeId: "employee-1",
				tripStart: new Date("2026-03-30T08:00:00.000Z"),
				tripEnd: new Date("2026-04-02T17:00:00.000Z"),
				employee: {
					id: "employee-1",
					employeeNumber: "E-1003",
					user: { name: "Katherine Johnson", email: "kat@example.com" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(result.summary.warningCount).toBe(1);
		expect(getCheck(result, "travel-expense-warnings")).toMatchObject({
			status: "warning",
			severity: "warning",
			count: 1,
		});
		expect(
			JSON.stringify(mockState.travelExpenseClaimFindMany.mock.calls[0]?.[0]?.where),
		).toContain("lte");
		expect(
			JSON.stringify(mockState.travelExpenseClaimFindMany.mock.calls[0]?.[0]?.where),
		).toContain("gte");
	});

	it("treats travel claims starting inside and ending after the selected period as warning-only", async () => {
		mockState.travelExpenseClaimFindMany.mockResolvedValue([
			{
				id: "claim-1",
				employeeId: "employee-1",
				tripStart: new Date("2026-04-29T08:00:00.000Z"),
				tripEnd: new Date("2026-05-02T17:00:00.000Z"),
				employee: {
					id: "employee-1",
					employeeNumber: "E-1003",
					user: { name: "Katherine Johnson", email: "kat@example.com" },
				},
			},
		]);

		const result = await getPayrollReadiness(defaultInput());

		expect(result.status).toBe("ready");
		expect(getCheck(result, "travel-expense-warnings")).toMatchObject({
			status: "warning",
			severity: "warning",
			count: 1,
		});
	});
});

describe("derivePayrollReadinessStatus", () => {
	it("returns unavailable when a required check is unavailable", () => {
		expect(
			derivePayrollReadinessStatus([
				{
					id: "required-source",
					group: "time",
					title: "Required source",
					status: "unavailable",
					severity: "blocker",
					count: 0,
					description: "Unavailable",
					required: true,
					affectedEmployees: [],
				},
			]),
		).toBe("unavailable");
	});

	it("keeps blocked and ready status behavior", () => {
		expect(
			derivePayrollReadinessStatus([
				{
					id: "blocker",
					group: "payrollSetup",
					title: "Blocker",
					status: "fail",
					severity: "blocker",
					count: 1,
					description: "Blocked",
					required: true,
					affectedEmployees: [],
				},
			]),
		).toBe("blocked");

		expect(
			derivePayrollReadinessStatus([
				{
					id: "warning",
					group: "time",
					title: "Warning",
					status: "warning",
					severity: "warning",
					count: 1,
					description: "Warning-only",
					required: false,
					affectedEmployees: [],
				},
			]),
		).toBe("ready");
	});
});
