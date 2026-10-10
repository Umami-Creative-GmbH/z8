import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecuteParams } from "./base-executor";

const mocks = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	getPayrollExportConfig: vi.fn(),
	createExportJob: vi.fn(),
	processExportJob: vi.fn(),
	signFileUrl: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions }),
	eq: (column: string, value: unknown) => ({ column, value }),
}));
vi.mock("@/db", () => ({
	db: { query: { employee: { findFirst: mocks.findEmployee } } },
}));
vi.mock("@/db/schema", () => ({
	employee: {
		userId: "employee.userId",
		organizationId: "employee.organizationId",
	},
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/payroll-export", () => ({
	getPayrollExportConfig: mocks.getPayrollExportConfig,
	createExportJob: mocks.createExportJob,
	processExportJob: mocks.processExportJob,
}));
vi.mock("../../infrastructure/signed-file-url", () => ({
	signFileUrl: mocks.signFileUrl,
}));

const { PayrollExportExecutor } = await import("./payroll-export-executor");
const { parseInstant } = await import("@/lib/datetime/temporal-core");

const params: ExecuteParams = {
	executionId: "execution-1",
	organizationId: "org-1",
	createdBy: "schedule-user",
	payrollConfigId: "payroll-config-1",
	reportConfig: { formatId: "datev_lohn" },
	// Fixtures for the executor's existing Luxon boundary; no date calculations.
	dateRange: {
		start: DateTime.fromISO("2026-08-01T00:00:00Z", { zone: "UTC" }),
		end: DateTime.fromISO("2026-08-31T23:59:59Z", { zone: "UTC" }),
	},
};

describe("scheduled payroll requester attribution", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getPayrollExportConfig.mockResolvedValue({
			config: { createdBy: "config-user" },
		});
		mocks.findEmployee.mockResolvedValue({ id: "employee-1" });
		mocks.createExportJob.mockResolvedValue({ jobId: "job-1", isAsync: false });
		mocks.processExportJob.mockResolvedValue({});
	});

	it("attributes the job to the schedule creator's organization-scoped employee", async () => {
		const result = await new PayrollExportExecutor().execute(params);

		expect(result.success).toBe(true);
		expect(mocks.findEmployee).toHaveBeenCalledWith({
			where: {
				conditions: [
					{ column: "employee.userId", value: "schedule-user" },
					{ column: "employee.organizationId", value: "org-1" },
				],
			},
			columns: { id: true },
		});
		expect(mocks.createExportJob).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				requestedById: "employee-1",
			}),
		);
	});

	it("does not fall back to the payroll config creator when the schedule creator is missing", async () => {
		const result = await new PayrollExportExecutor().execute({
			...params,
			createdBy: undefined,
		});

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("schedule creator"),
		});
		expect(mocks.findEmployee).not.toHaveBeenCalled();
		expect(mocks.createExportJob).not.toHaveBeenCalled();
	});

	it("does not create a job without an employee in the schedule organization", async () => {
		mocks.findEmployee.mockResolvedValue(undefined);

		const result = await new PayrollExportExecutor().execute(params);

		expect(result.success).toBe(false);
		expect(mocks.createExportJob).not.toHaveBeenCalled();
		expect(mocks.processExportJob).not.toHaveBeenCalled();
	});

	it("excludes the same user's employee record from another organization", async () => {
		const otherEmployee = {
			id: "other-employee",
			userId: "schedule-user",
			organizationId: "org-2",
		};
		mocks.findEmployee.mockImplementation(({ where }) => {
			const matches = where.conditions.every(
				({ column, value }: { column: string; value: string }) =>
					column === "employee.userId"
						? otherEmployee.userId === value
						: otherEmployee.organizationId === value,
			);
			return Promise.resolve(matches ? otherEmployee : undefined);
		});

		const result = await new PayrollExportExecutor().execute(params);

		expect(result.success).toBe(false);
		expect(mocks.createExportJob).not.toHaveBeenCalled();
	});
});

describe("scheduled payroll export configuration", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it.each(["successfactors_api", "successfactors_csv", "workday_api"])(
		"accepts the registered format %s",
		(formatId) => {
			expect(new PayrollExportExecutor().validateConfig({ formatId })).toEqual({ valid: true });
		},
	);

	it("rejects an unknown format id", () => {
		const result = new PayrollExportExecutor().validateConfig({ formatId: "lexware" });

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual([expect.stringContaining("lexware")]);
	});

	it("rejects a missing format id", () => {
		expect(new PayrollExportExecutor().validateConfig({}).valid).toBe(false);
	});

	it("accepts a format the organization has an active configuration for", async () => {
		mocks.getPayrollExportConfig.mockResolvedValue({ config: { id: "config-1" } });

		await expect(
			new PayrollExportExecutor().validateForOrganization("org-1", { formatId: "workday_api" }),
		).resolves.toEqual({ valid: true });
		expect(mocks.getPayrollExportConfig).toHaveBeenCalledWith("org-1", "workday_api");
	});

	it("rejects a registered format the organization has not configured", async () => {
		mocks.getPayrollExportConfig.mockResolvedValue(null);

		const result = await new PayrollExportExecutor().validateForOrganization("org-1", {
			formatId: "sage_lohn",
		});

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual([expect.stringContaining("sage_lohn")]);
	});

	it("rejects an unknown format without looking up a configuration", async () => {
		const result = await new PayrollExportExecutor().validateForOrganization("org-1", {
			formatId: "custom",
		});

		expect(result.valid).toBe(false);
		expect(mocks.getPayrollExportConfig).not.toHaveBeenCalled();
	});
});

describe("scheduled payroll file (#1008)", () => {
	const s3Key = "payroll-exports/org-1/job-1/export.csv";
	const link = {
		url: "https://s3.example/exports-bucket/payroll-exports/org-1/job-1/export.csv?sig",
		lifetimeSeconds: 900,
		expiresAt: parseInstant("2026-10-10T12:15:00Z"),
	};

	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getPayrollExportConfig.mockResolvedValue({ config: {} });
		mocks.findEmployee.mockResolvedValue({ id: "employee-1" });
		mocks.createExportJob.mockResolvedValue({ jobId: "job-1", isAsync: false });
		mocks.signFileUrl.mockResolvedValue(link);
	});

	it("stores the file whatever its size and records the job's key with a link signed for it", async () => {
		mocks.processExportJob.mockResolvedValue({
			s3Key,
			downloadUrl: link.url,
			result: { metadata: { workPeriodCount: 3 } },
		});

		const result = await new PayrollExportExecutor().execute(params);

		expect(mocks.processExportJob).toHaveBeenCalledWith(
			{ jobId: "job-1", organizationId: "org-1" },
			{ storeFile: true },
		);
		// Signed with the private storage default, as the payroll job's own link is.
		expect(mocks.signFileUrl).toHaveBeenCalledWith("org-1", s3Key);
		expect(result).toEqual({
			success: true,
			underlyingJobId: "job-1",
			underlyingJobType: "payroll_export",
			s3Key,
			fileUrl: link,
			recordCount: 3,
		});
	});

	it("reports no file and no link when the format produces none", async () => {
		// An API-based format (Personio) syncs records instead of producing a file.
		mocks.processExportJob.mockResolvedValue({ apiResult: { totalRecords: 2 } });

		const result = await new PayrollExportExecutor().execute(params);

		expect(result.success).toBe(true);
		expect(result.s3Key).toBeUndefined();
		expect(result.fileUrl).toBeUndefined();
		expect(mocks.signFileUrl).not.toHaveBeenCalled();
	});
});
