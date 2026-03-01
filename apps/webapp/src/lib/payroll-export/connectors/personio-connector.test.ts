import { describe, expect, it, vi } from "vitest";
import type { IPayrollExporter } from "../types";
import { createPersonioConnector } from "./personio-connector";

vi.mock("../exporters/personio", () => ({
	personioExporter: createExporterStub({}),
}));

describe("createPersonioConnector", () => {
	it("delegates validateConfig to the underlying exporter", async () => {
		const validateConfig = vi.fn().mockResolvedValue({ valid: true });
		const exporter = createExporterStub({ validateConfig });
		const connector = createPersonioConnector(exporter);

		const config = { employeeMatchStrategy: "employeeNumber" };
		await expect(connector.validateConfig(config)).resolves.toEqual({ valid: true });
		expect(validateConfig).toHaveBeenCalledWith(config);
	});

	it("delegates testConnection to the underlying exporter", async () => {
		const testConnection = vi.fn().mockResolvedValue({ success: true });
		const exporter = createExporterStub({ testConnection });
		const connector = createPersonioConnector(exporter);

		const organizationId = "org_123";
		const config = { apiTimeoutMs: 5000 };
		await expect(connector.testConnection(organizationId, config)).resolves.toEqual({
			success: true,
		});
		expect(testConnection).toHaveBeenCalledWith(organizationId, config);
	});

	it("delegates export to the underlying exporter", async () => {
		const exportResult = {
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
		};
		const exportFn = vi.fn().mockResolvedValue(exportResult);
		const exporter = createExporterStub({ export: exportFn });
		const connector = createPersonioConnector(exporter);

		const organizationId = "org_123";
		const workPeriods = [];
		const absences = [];
		const mappings = [];
		const config = { batchSize: 100 };

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
		const getSyncThreshold = vi.fn().mockReturnValue(750);
		const exporter = createExporterStub({ getSyncThreshold });
		const connector = createPersonioConnector(exporter);

		expect(connector.getSyncThreshold()).toBe(750);
		expect(getSyncThreshold).toHaveBeenCalledTimes(1);
	});
});

function createExporterStub(overrides: Partial<IPayrollExporter>): IPayrollExporter {
	return {
		exporterId: "personio",
		exporterName: "Personio",
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
