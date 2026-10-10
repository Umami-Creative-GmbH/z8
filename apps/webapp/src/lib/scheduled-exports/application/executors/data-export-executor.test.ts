import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

const mocks = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	getExportById: vi.fn(),
	signFileUrl: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: { employee: { findFirst: mocks.findEmployee } },
		insert: () => ({ values: () => ({ returning: async () => [{ id: "export-1" }] }) }),
	},
	dataExport: {},
	employee: {},
}));
vi.mock("@/lib/export/export-service", () => ({
	getExportById: mocks.getExportById,
	processExport: vi.fn(),
}));
vi.mock("../../infrastructure/signed-file-url", () => ({ signFileUrl: mocks.signFileUrl }));
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

describe("DataExportExecutor file URL (#1008)", () => {
	it("hands delivery a 7-day URL to the stored file together with its lifetime", async () => {
		const fileUrl = {
			url: "https://s3.example/export-1.zip?sig",
			lifetimeSeconds: 604800,
			expiresAt: parseInstant("2026-10-17T12:00:00Z"),
		};
		mocks.findEmployee.mockResolvedValue({ id: "employee-1" });
		mocks.getExportById.mockResolvedValue({
			status: "completed",
			s3Key: "exports/org-1/export-1.zip",
			fileSizeBytes: 42,
		});
		mocks.signFileUrl.mockResolvedValue(fileUrl);

		const result = await new DataExportExecutor().execute({
			organizationId: "org-1",
			createdBy: "owner-user",
			reportConfig: { categories: ["employees"] },
			// Fixtures for the executor's existing Luxon boundary; no date calculations.
			dateRange: {
				start: DateTime.fromISO("2026-09-01T00:00:00Z", { zone: "UTC" }),
				end: DateTime.fromISO("2026-09-30T23:59:59Z", { zone: "UTC" }),
			},
		});

		expect(mocks.signFileUrl).toHaveBeenCalledWith("org-1", "exports/org-1/export-1.zip", 604800);
		expect(result).toMatchObject({
			success: true,
			s3Key: "exports/org-1/export-1.zip",
			fileUrl,
		});
	});
});
