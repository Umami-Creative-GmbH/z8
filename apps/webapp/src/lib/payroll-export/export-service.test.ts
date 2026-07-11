import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findFirst: vi.fn(),
	updates: [] as Array<{ set?: unknown; where?: unknown }>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ operator: "and", conditions })),
	eq: vi.fn((column: unknown, value: unknown) => ({ operator: "eq", column, value })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			payrollExportJob: {
				findFirst: mockState.findFirst,
			},
		},
		update: vi.fn(() => {
			const update: { set?: unknown; where?: unknown } = {};
			mockState.updates.push(update);
			return {
				set: vi.fn((values: unknown) => {
					update.set = values;
					return {
						where: vi.fn(async (predicate: unknown) => {
							update.where = predicate;
						}),
					};
				}),
			};
		}),
	},
	payrollExportJob: {
		id: "payroll_export_job.id",
		organizationId: "payroll_export_job.organization_id",
	},
	payrollExportSyncRecord: {},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		error: vi.fn(),
	})),
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: vi.fn(),
	uploadExport: vi.fn(),
}));

vi.mock("./connectors/personio-connector", () => ({ personioConnector: {} }));
vi.mock("./connectors/successfactors-connector", () => ({ successFactorsConnector: {} }));
vi.mock("./exporters/workday/workday-connector", () => ({ workdayConnector: {} }));
vi.mock("./exporters/successfactors/successfactors-formatter", () => ({
	successFactorsFormatter: { formatId: "successfactors" },
}));
vi.mock("./connectors/registry", () => ({
	PayrollConnectorRegistry: class {
		register() {}
		get() {}
		has() {
			return false;
		}
		list() {
			return [];
		}
	},
}));

vi.mock("./formatters/datev-lohn-formatter", () => ({
	DatevLohnFormatter: class {
		formatId = "datev_lohn";
	},
}));
vi.mock("./formatters/lexware-lohn-formatter", () => ({
	LexwareLohnFormatter: class {
		formatId = "lexware_lohn";
	},
}));
vi.mock("./formatters/sage-lohn-formatter", () => ({
	SageLohnFormatter: class {
		formatId = "sage_lohn";
	},
}));

vi.mock("./data-fetcher", () => ({
	countWorkPeriods: vi.fn(),
	fetchAbsencesForExport: vi.fn(),
	fetchWorkPeriodsForExport: vi.fn(),
	getPayrollExportConfig: vi.fn(),
	getWageTypeMappings: vi.fn(),
}));

const { markPayrollExportJobFailed, processExportJob } = await import("./export-service");

const scopedPredicate = (jobId: string, organizationId: string) => ({
	operator: "and",
	conditions: [
		{ operator: "eq", column: "payroll_export_job.id", value: jobId },
		{
			operator: "eq",
			column: "payroll_export_job.organization_id",
			value: organizationId,
		},
	],
});

describe("payroll export job transitions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.updates.length = 0;
		mockState.findFirst.mockResolvedValue(undefined);
	});

	it("scopes processExportJob processing, lookup, and failure transitions by job and organization", async () => {
		const jobId = "job-1";
		const organizationId = "org-1";

		await expect(processExportJob({ jobId, organizationId })).rejects.toThrow(
			`Job not found: ${jobId}`,
		);

		expect(mockState.updates).toHaveLength(2);
		expect(mockState.updates[0]?.where).toEqual(scopedPredicate(jobId, organizationId));
		expect(mockState.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: scopedPredicate(jobId, organizationId) }),
		);
		expect(mockState.updates[1]?.where).toEqual(scopedPredicate(jobId, organizationId));
	});

	it("marks a payroll export job failed with a generic message and tenant scope", async () => {
		const before = Date.now();

		await markPayrollExportJobFailed({
			jobId: "job-2",
			organizationId: "org-2",
			errorMessage: "Payroll export processing failed",
		});

		expect(mockState.updates).toHaveLength(1);
		const failedUpdate = mockState.updates.at(0);
		if (!failedUpdate) {
			throw new Error("Expected a failed payroll export job update");
		}
		expect(failedUpdate.set).toEqual({
			status: "failed",
			errorMessage: "Payroll export processing failed",
			completedAt: expect.any(Date),
		});
		expect(
			(failedUpdate.set as { completedAt: Date }).completedAt.getTime(),
		).toBeGreaterThanOrEqual(before);
		expect(failedUpdate.where).toEqual(scopedPredicate("job-2", "org-2"));
	});
});
