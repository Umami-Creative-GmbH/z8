import { describe, expect, it, vi } from "vitest";
import type { IPayrollExporter } from "../types";
import { createSuccessFactorsConnector } from "./successfactors-connector";

vi.mock("../exporters/successfactors", () => ({
	successFactorsExporter: createExporterStub({}),
}));

describe("createSuccessFactorsConnector", () => {
	it("delegates validateConfig to the underlying exporter", async () => {
		const validateConfig = vi.fn().mockResolvedValue({ valid: false, errors: ["invalid"] });
		const exporter = createExporterStub({ validateConfig });
		const connector = createSuccessFactorsConnector(exporter);

		const config = { companyId: "ACME" };
		await expect(connector.validateConfig(config)).resolves.toEqual({
			valid: false,
			errors: ["invalid"],
		});
		expect(validateConfig).toHaveBeenCalledWith(config);
	});

	it("delegates testConnection to the underlying exporter", async () => {
		const testConnection = vi
			.fn()
			.mockResolvedValue({ success: false, error: "Network unavailable" });
		const exporter = createExporterStub({ testConnection });
		const connector = createSuccessFactorsConnector(exporter);

		const organizationId = "org_123";
		const config = { instanceUrl: "https://example.successfactors.com" };
		await expect(connector.testConnection(organizationId, config)).resolves.toEqual({
			success: false,
			error: "Network unavailable",
		});
		expect(testConnection).toHaveBeenCalledWith(organizationId, config);
	});

	it("delegates export to the underlying exporter", async () => {
		const exportResult = {
			success: true,
			totalRecords: 3,
			syncedRecords: 2,
			failedRecords: 1,
			skippedRecords: 0,
			errors: [],
			metadata: {
				employeeCount: 2,
				dateRange: { start: "2026-01-01", end: "2026-01-31" },
				apiCallCount: 4,
				durationMs: 42,
			},
		};
		const exportFn = vi.fn().mockResolvedValue(exportResult);
		const exporter = createExporterStub({ export: exportFn });
		const connector = createSuccessFactorsConnector(exporter);

		const organizationId = "org_123";
		const workPeriods = [];
		const absences = [];
		const mappings = [];
		const config = { batchSize: 10 };

		await expect(
			connector.export(organizationId, workPeriods, absences, mappings, config),
		).resolves.toEqual(exportResult);
		expect(exportFn).toHaveBeenCalledWith(
			organizationId,
			workPeriods,
			absences,
			mappings,
			config,
		);
	});

	it("delegates getSyncThreshold to the underlying exporter", () => {
		const getSyncThreshold = vi.fn().mockReturnValue(250);
		const exporter = createExporterStub({ getSyncThreshold });
		const connector = createSuccessFactorsConnector(exporter);

		expect(connector.getSyncThreshold()).toBe(250);
		expect(getSyncThreshold).toHaveBeenCalledTimes(1);
	});
});

function createExporterStub(overrides: Partial<IPayrollExporter>): IPayrollExporter {
	return {
		exporterId: "successfactors_api",
		exporterName: "SAP SuccessFactors (API)",
		version: "1.0.0",
		validateConfig: async () => ({ valid: true }),
		testConnection: async () => ({ success: true }),
		export: async () => ({
			success: true,
			totalRecords: 0,
			syncedRecords: 0,
			failedRecords: 0,
			skippedRecords: 0,
			errors: [],
			metadata: {
				employeeCount: 0,
				dateRange: { start: "", end: "" },
				apiCallCount: 0,
				durationMs: 0,
			},
		}),
		getSyncThreshold: () => 500,
		...overrides,
	};
}
