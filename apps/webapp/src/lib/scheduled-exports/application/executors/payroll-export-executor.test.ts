import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	createExportJob: vi.fn(),
	processExportJob: vi.fn(),
	getPayrollExportConfig: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: mockState.findEmployee,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "employeeId",
		userId: "employeeUserId",
		organizationId: "employeeOrganizationId",
		legalEntityId: "employeeLegalEntityId",
		isActive: "employeeIsActive",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock("@/lib/payroll-export", () => ({
	createExportJob: mockState.createExportJob,
	processExportJob: mockState.processExportJob,
	getPayrollExportConfig: mockState.getPayrollExportConfig,
}));

const { PayrollExportExecutor } = await import("./payroll-export-executor");

describe("PayrollExportExecutor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getPayrollExportConfig.mockResolvedValue({
			config: {
				createdBy: "user-1",
			},
		});
		mockState.findEmployee.mockResolvedValue({ id: "emp-1" });
		mockState.createExportJob.mockResolvedValue({ jobId: "job-1", isAsync: true });
		mockState.processExportJob.mockResolvedValue({ result: { metadata: { workPeriodCount: 3 } } });
	});

	it("uses the config creator's employee in the same legal entity as the requester", async () => {
		const { DateTime } = await import("luxon");
		const executor = new PayrollExportExecutor();

		const result = await executor.execute({
			organizationId: "org-1",
			legalEntityId: "entity-a",
			reportConfig: { formatId: "datev_lohn" },
			dateRange: {
				start: DateTime.fromISO("2026-01-01"),
				end: DateTime.fromISO("2026-01-31"),
			},
			payrollConfigId: "config-1",
		});

		expect(result.success).toBe(true);
		expect(mockState.createExportJob).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				legalEntityId: "entity-a",
				requestedById: "emp-1",
			}),
		);
		expect(mockState.createExportJob).not.toHaveBeenCalledWith(
			expect.objectContaining({ requestedById: "config-1" }),
		);
	});

	it("fails clearly when the config creator has no employee in the selected legal entity", async () => {
		const { DateTime } = await import("luxon");
		mockState.findEmployee.mockResolvedValue(null);
		const executor = new PayrollExportExecutor();

		const result = await executor.execute({
			organizationId: "org-1",
			legalEntityId: "entity-a",
			reportConfig: { formatId: "datev_lohn" },
			dateRange: {
				start: DateTime.fromISO("2026-01-01"),
				end: DateTime.fromISO("2026-01-31"),
			},
		});

		expect(result).toEqual({
			success: false,
			error: "Unable to determine requester employee for scheduled payroll export",
		});
		expect(mockState.createExportJob).not.toHaveBeenCalled();
	});
});
