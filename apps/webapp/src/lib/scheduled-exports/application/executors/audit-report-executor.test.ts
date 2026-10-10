import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecuteParams } from "./base-executor";

const mocks = vi.hoisted(() => ({
	findAuditLogs: vi.fn(),
	uploadExport: vi.fn(),
	getPresignedUrl: vi.fn(),
}));

vi.mock("@/db", () => ({
	auditLog: {},
	db: { query: { auditLog: { findMany: mocks.findAuditLogs } } },
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadExport: mocks.uploadExport,
	getPresignedUrl: mocks.getPresignedUrl,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

const { AuditReportExecutor } = await import("./audit-report-executor");

const params: ExecuteParams = {
	executionId: "5f0c7c1e-0b7e-4a39-9d2a-0f5e1d7c9a10",
	organizationId: "org-a",
	reportConfig: {},
	// Fixtures for the executor's existing Luxon boundary; no date calculations.
	dateRange: {
		start: DateTime.fromISO("2026-09-01T00:00:00", { zone: "Europe/Berlin" }),
		end: DateTime.fromISO("2026-09-30T23:59:59", { zone: "Europe/Berlin" }),
	},
};

describe("scheduled audit report storage key", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.findAuditLogs.mockResolvedValue([]);
		mocks.uploadExport.mockResolvedValue(undefined);
		mocks.getPresignedUrl.mockImplementation((_org: string, key: string) =>
			Promise.resolve(`https://storage.test/${key}`),
		);
	});

	it("stores each execution under the organization's prefix, the execution id and the date range", async () => {
		const result = await new AuditReportExecutor().execute(params);

		expect(result).toMatchObject({
			success: true,
			s3Key:
				"audit-reports/org-a/5f0c7c1e-0b7e-4a39-9d2a-0f5e1d7c9a10/audit_report_20260901_20260930.csv",
		});
		expect(mocks.uploadExport).toHaveBeenCalledWith(
			"org-a",
			result.s3Key,
			expect.any(Buffer),
			"text/csv",
		);
		expect(mocks.getPresignedUrl).toHaveBeenCalledWith("org-a", result.s3Key, 604800);
	});

	it("gives a rerun or a second schedule over the same date range its own object", async () => {
		const executor = new AuditReportExecutor();

		const first = await executor.execute(params);
		const second = await executor.execute({
			...params,
			executionId: "9b8a2d4f-6c1e-4f7a-8e3b-2a1d0c9f8e7d",
		});

		expect(first.s3Key).not.toBe(second.s3Key);
		expect(mocks.uploadExport.mock.calls.map(([, key]) => key)).toEqual([
			first.s3Key,
			second.s3Key,
		]);
		expect(first.s3Url).toBe(`https://storage.test/${first.s3Key}`);
		expect(second.s3Url).toBe(`https://storage.test/${second.s3Key}`);
	});

	it("keeps organization A's reports out of organization B's prefix", async () => {
		const result = await new AuditReportExecutor().execute({
			...params,
			organizationId: "org-b",
		});

		expect(result.s3Key?.startsWith("audit-reports/org-b/")).toBe(true);
		expect(result.s3Key?.startsWith("audit-reports/org-a/")).toBe(false);
	});

	it.each([
		["an execution id", { executionId: "../org-b/x" }],
		["an organization id", { organizationId: "org-a/../org-b" }],
	])("refuses %s that would leave the organization's prefix", async (_label, override) => {
		const result = await new AuditReportExecutor().execute({ ...params, ...override });

		expect(result.success).toBe(false);
		expect(mocks.uploadExport).not.toHaveBeenCalled();
	});
});
