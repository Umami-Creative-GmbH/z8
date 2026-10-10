import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPayrollExportConfig: vi.fn() }));

vi.mock("./audit-report-executor", () => ({
	AuditReportExecutor: class {
		reportType = "audit_report";
		validateConfig() {
			return { valid: true };
		}
	},
}));
vi.mock("./data-export-executor", () => ({
	DataExportExecutor: class {
		reportType = "data_export";
		validateConfig(config: { categories?: string[] }) {
			return config.categories?.length
				? { valid: true }
				: { valid: false, errors: ["At least one category is required for data exports"] };
		}
	},
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ employee: {} }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/payroll-export", () => ({
	getPayrollExportConfig: mocks.getPayrollExportConfig,
	createExportJob: vi.fn(),
	processExportJob: vi.fn(),
}));

const { validateScheduledReportConfig } = await import("./registry");

describe("validateScheduledReportConfig", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getPayrollExportConfig.mockResolvedValue({ config: { id: "config-1" } });
	});

	it.each([
		"successfactors_api",
		"successfactors_csv",
		"workday_api",
	])("saves a payroll schedule for the configured format %s", async (formatId) => {
		await expect(
			validateScheduledReportConfig("org-1", "payroll_export", { formatId }),
		).resolves.toEqual([]);
		expect(mocks.getPayrollExportConfig).toHaveBeenCalledWith("org-1", formatId);
	});

	it("refuses a payroll schedule for an unknown format", async () => {
		await expect(
			validateScheduledReportConfig("org-1", "payroll_export", { formatId: "sage" }),
		).resolves.toEqual([expect.stringContaining("Invalid formatId: sage")]);
	});

	it("refuses a payroll schedule for a format the organization has not configured", async () => {
		mocks.getPayrollExportConfig.mockResolvedValue(null);

		await expect(
			validateScheduledReportConfig("org-1", "payroll_export", { formatId: "personio" }),
		).resolves.toEqual([expect.stringContaining("not configured: personio")]);
	});

	it("validates other report types with their executor's own validation", async () => {
		await expect(
			validateScheduledReportConfig("org-1", "data_export", { categories: [] }),
		).resolves.toEqual(["At least one category is required for data exports"]);
	});

	it("refuses an unknown report type", async () => {
		await expect(validateScheduledReportConfig("org-1", "payslips", {})).resolves.toEqual([
			"Unknown report type: payslips",
		]);
	});
});
