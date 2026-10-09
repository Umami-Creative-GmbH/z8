import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, dataExport: {}, employee: {} }));
vi.mock("@/lib/export/export-service", () => ({
	getExportById: vi.fn(),
	processExport: vi.fn(),
}));
vi.mock("@/lib/storage/export-s3-client", () => ({ getPresignedUrl: vi.fn() }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

const { DataExportExecutor } = await import("./data-export-executor");

describe("DataExportExecutor.validateConfig", () => {
	it("accepts work periods, the category that carries the project and task columns", () => {
		expect(new DataExportExecutor().validateConfig({ categories: ["work_periods"] })).toEqual({
			valid: true,
			errors: undefined,
		});
	});

	it("still refuses an unknown category", () => {
		expect(new DataExportExecutor().validateConfig({ categories: ["salaries"] }).valid).toBe(false);
	});
});
