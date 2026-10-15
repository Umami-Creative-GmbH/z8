import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAYROLL_EXPORT_FORMATS } from "@/lib/payroll-export/format-registry";
import type { UnconfirmedPayrollRun } from "@/lib/travel-expenses/payroll-run";

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
	listUnconfirmedPayrollRuns: vi.fn<() => Promise<UnconfirmedPayrollRun[]>>(),
}));

vi.mock("@/db", () => ({
	db: {},
	payrollExportConfig: {},
	payrollExportFormat: {},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
	getAbility: vi.fn(async () => ({ can: () => false })),
}));

vi.mock("@/lib/payroll-access/permissions", () => ({
	resolvePayrollAccessibleEmployeeIds:
		mockState.resolvePayrollAccessibleEmployeeIds,
	hasActivePayrollAccessGrant: vi.fn(async () => true),
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

vi.mock("@/lib/payroll-access/adjustment-coverage", () => ({
	listDepartedEmployeesCoveredForExport: vi.fn(async () => []),
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

vi.mock("@/lib/travel-expenses/payroll-run", () => ({
	listUnconfirmedPayrollRuns: mockState.listUnconfirmedPayrollRuns,
	discardPayrollRun: vi.fn(),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));

vi.mock("@/lib/effect/result", async () => {
	const { Effect } = await import("effect");

	return {
		runServerActionSafe: async <T>(
			effect: Parameters<typeof Effect.runPromise<T>>[0],
		) => ({
			success: true as const,
			data: await Effect.runPromise(effect),
		}),
	};
});

const { getScopedPayrollRunsAction, startScopedPayrollExportAction } =
	await import("./actions");

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
		mockState.createExportJob.mockResolvedValue({
			jobId: "job-1",
			isAsync: true,
		});
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
		mockState.createExportJob.mockResolvedValueOnce({
			jobId: "job-sync",
			isAsync: false,
		});
		mockState.processExportJob.mockResolvedValueOnce({
			result: {
				content: "sync-content",
				metadata: {
					unmappedOvertimePayouts: [
						{
							id: "payout-1",
							employeeId: "employee-1",
							day: "2026-01-15",
							minutes: 300,
						},
					],
				},
			},
		});

		const result = await startScopedPayrollExportAction(request);

		expect(result).toEqual({
			success: true,
			data: {
				jobId: "job-sync",
				isAsync: false,
				fileContent: "sync-content",
				// #1001: the export reports the overtime payouts it could not carry.
				unmappedOvertimePayoutCount: 1,
			},
		});
		expect(mockState.processExportJob).toHaveBeenCalledExactlyOnceWith({
			jobId: "job-sync",
			organizationId: "org-1",
		});
		expect(mockState.enqueuePayrollExportJob).not.toHaveBeenCalled();
	});
});

describe("payroll workspace export formats", () => {
	const registered = PAYROLL_EXPORT_FORMATS as unknown as object[];

	beforeEach(() => {
		vi.clearAllMocks();
		mockState.createExportJob.mockResolvedValue({
			jobId: "job-1",
			isAsync: true,
		});
	});

	afterEach(() => {
		const fake = registered.findIndex(
			(format) => "id" in format && format.id === "fake_lohn",
		);
		if (fake >= 0) registered.splice(fake, 1);
	});

	it("exports in a file format registered for the workspace with no further edits", async () => {
		registered.push({ id: "fake_lohn", kind: "file", payrollWorkspace: true });

		await startScopedPayrollExportAction({ ...request, formatId: "fake_lohn" });

		expect(mockState.createExportJob).toHaveBeenCalledWith(
			expect.objectContaining({ formatId: "fake_lohn" }),
		);
	});

	it.each(["successfactors_csv", "personio", "unknown_lohn"])(
		"refuses %s, which the workspace does not offer",
		async (formatId) => {
			registered.push({
				id: "fake_lohn",
				kind: "file",
				payrollWorkspace: true,
			});

			await expect(
				startScopedPayrollExportAction({ ...request, formatId }),
			).rejects.toBeDefined();
			expect(mockState.createExportJob).not.toHaveBeenCalled();
		},
	);
});

describe("getScopedPayrollRunsAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.resolvePayrollAccessibleEmployeeIds.mockResolvedValue([
			"employee-1",
			"employee-2",
		]);
		mockState.listUnconfirmedPayrollRuns.mockResolvedValue([]);
	});

	afterEach(() => {
		mockState.resolvePayrollAccessibleEmployeeIds.mockResolvedValue([
			"employee-1",
		]);
	});

	function run(jobId: string, employeeIds: string[]): UnconfirmedPayrollRun {
		return {
			jobId,
			formatId: "datev_lohn",
			periodStart: "2026-01-01",
			periodEnd: "2026-01-31",
			exportedAt: "2026-02-01T12:00:00Z",
			includedReports: employeeIds.length,
			employeeIds,
			partlyConfirmed: false,
		};
	}

	it("keeps only fully authorized runs, in source order, without exposing employee IDs", async () => {
		const first = run("first", ["employee-2", "employee-1", "employee-2"]);
		const mixed = run("mixed", ["employee-1", "outside-scope"]);
		const last = run("last", ["employee-1"]);
		mockState.listUnconfirmedPayrollRuns.mockResolvedValue([
			first,
			mixed,
			last,
		]);

		const result = await getScopedPayrollRunsAction();

		const { employeeIds: _firstIds, ...expectedFirst } = first;
		const { employeeIds: _lastIds, ...expectedLast } = last;
		expect(result).toEqual({
			success: true,
			data: [expectedFirst, expectedLast],
		});
		expect(
			mockState.resolvePayrollAccessibleEmployeeIds,
		).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			payrollEmployeeId: "employee-1",
		});
		expect(
			mockState.listUnconfirmedPayrollRuns,
		).toHaveBeenCalledExactlyOnceWith({}, "org-1");
		expect(first.employeeIds).toEqual([
			"employee-2",
			"employee-1",
			"employee-2",
		]);
	});

	it("returns no runs when every run contains an unauthorized employee", async () => {
		mockState.listUnconfirmedPayrollRuns.mockResolvedValue([
			run("outside", ["outside-scope"]),
			run("mixed", ["employee-1", "outside-scope"]),
		]);

		expect(await getScopedPayrollRunsAction()).toEqual({
			success: true,
			data: [],
		});
	});

	it("refuses an empty payroll access scope before loading runs", async () => {
		mockState.resolvePayrollAccessibleEmployeeIds.mockResolvedValue([]);

		await expect(getScopedPayrollRunsAction()).rejects.toMatchObject({
			_tag: "AuthorizationError",
		});
		expect(mockState.listUnconfirmedPayrollRuns).not.toHaveBeenCalled();
	});
});
