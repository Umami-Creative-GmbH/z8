import { describe, expect, it, vi } from "vitest";

// Only the format registration is under test; nothing touches the database.
vi.mock("@/db", () => ({ db: {}, payrollExportJob: {}, payrollExportSyncRecord: {} }));
vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: vi.fn(),
	uploadExport: vi.fn(),
}));

const {
	getAvailableExporters,
	getAvailableFormatters,
	getExporter,
	getFormatter,
	isApiBasedExport,
} = await import("./export-service");
const { payrollExportFormatIds, payrollExportFormatKind } = await import("./format-registry");

describe("payroll export service formats", () => {
	it("registers a file formatter for every file format and a connector for every API format", () => {
		for (const formatId of payrollExportFormatIds()) {
			const kind = payrollExportFormatKind(formatId);
			expect(isApiBasedExport(formatId), formatId).toBe(kind === "api");
			if (kind === "file") {
				expect(getFormatter(formatId)?.formatId, formatId).toBe(formatId);
				expect(getExporter(formatId), formatId).toBeUndefined();
			} else {
				expect(getExporter(formatId)?.exporterId, formatId).toBe(formatId);
				expect(getFormatter(formatId), formatId).toBeUndefined();
			}
		}
	});

	it("registers no implementation outside the format registry", () => {
		const implemented = [
			...getAvailableFormatters().map((formatter) => formatter.formatId),
			...getAvailableExporters().map((exporter) => exporter.exporterId),
		];

		expect(implemented.toSorted()).toEqual(
			[
				"datev_lohn",
				"lexware_lohn",
				"personio",
				"sage_lohn",
				"successfactors_api",
				"successfactors_csv",
				"workday_api",
			].toSorted(),
		);
	});
});
