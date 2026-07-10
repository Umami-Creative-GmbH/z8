import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getAuthContext: vi.fn(async () => ({
		user: { id: "user-1", email: "payroll@example.com", name: "Payroll User" },
		session: { activeOrganizationId: "org-1" },
		employee: { id: "employee-1", organizationId: "org-1", role: "manager" },
	})),
	resolvePayrollAccessibleEmployeeIds: vi.fn(async () => ["employee-1"]),
	getPayrollExportConfig: vi.fn(async () => ({ config: { id: "config-1" } })),
	createExportJob: vi.fn(async () => ({ jobId: "job-1", isAsync: true })),
	enqueuePayrollExportJob: vi.fn(async () => undefined),
	processExportJob: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {},
	payrollExportConfig: {},
	payrollExportFormat: {},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));

vi.mock("@/lib/payroll-access/permissions", () => ({
	resolvePayrollAccessibleEmployeeIds: mockState.resolvePayrollAccessibleEmployeeIds,
	intersectPayrollScope: ({
		allowedEmployeeIds,
		requestedEmployeeIds,
	}: {
		allowedEmployeeIds: string[];
		requestedEmployeeIds?: string[];
	}) =>
		(requestedEmployeeIds ?? allowedEmployeeIds)
			.filter((employeeId) => allowedEmployeeIds.includes(employeeId))
			.sort(),
}));

vi.mock("@/lib/payroll-export", () => ({
	createExportJob: mockState.createExportJob,
	enqueuePayrollExportJob: mockState.enqueuePayrollExportJob,
	getFormatter: vi.fn(() => ({})),
	getPayrollExportConfig: mockState.getPayrollExportConfig,
	processExportJob: mockState.processExportJob,
}));

vi.mock("@/lib/payroll-workspace/pdf-exporter", () => ({
	exportPayrollSummaryToPDF: vi.fn(),
	generatePayrollPDFFilename: vi.fn(),
}));

vi.mock("@/lib/payroll-workspace/summary", () => ({
	getPayrollWorkspaceSummary: vi.fn(),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));

vi.mock("@/lib/effect/result", async () => {
	const { Effect } = await import("effect");

	return {
		runServerActionSafe: async <T>(effect: Parameters<typeof Effect.runPromise<T>>[0]) => ({
			success: true as const,
			data: await Effect.runPromise(effect),
		}),
	};
});

const { startScopedPayrollExportAction } = await import("./actions");

const request = {
	formatId: "datev_lohn",
	startDate: "2026-01-01",
	endDate: "2026-01-31",
	label: "January 2026",
	employeeIds: ["employee-1"],
};

describe("startScopedPayrollExportAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.createExportJob.mockResolvedValue({ jobId: "job-1", isAsync: true });
	});

	it("queues async exports with the trusted organization scope", async () => {
		const result = await startScopedPayrollExportAction(request);

		expect(result).toEqual({
			success: true,
			data: { jobId: "job-1", isAsync: true },
		});
		expect(mockState.enqueuePayrollExportJob).toHaveBeenCalledExactlyOnceWith({
			jobId: "job-1",
			organizationId: "org-1",
		});
		expect(mockState.processExportJob).not.toHaveBeenCalled();
	});

	it("processes synchronous exports inline with the trusted organization scope", async () => {
		mockState.createExportJob.mockResolvedValueOnce({ jobId: "job-sync", isAsync: false });
		mockState.processExportJob.mockResolvedValueOnce({ result: { content: "sync-content" } });

		const result = await startScopedPayrollExportAction(request);

		expect(result).toEqual({
			success: true,
			data: { jobId: "job-sync", isAsync: false, fileContent: "sync-content" },
		});
		expect(mockState.processExportJob).toHaveBeenCalledExactlyOnceWith({
			jobId: "job-sync",
			organizationId: "org-1",
		});
		expect(mockState.enqueuePayrollExportJob).not.toHaveBeenCalled();
	});
});
