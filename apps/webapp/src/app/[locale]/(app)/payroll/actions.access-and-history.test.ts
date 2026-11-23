import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollExportJobSummary } from "@/lib/payroll-export/types";

// Everyone is an employee here: External Contractor exclusion has its own PostgreSQL suites (#1997).
vi.mock("@/lib/engagement/engagement-stints", async () => ({
	loadEmployeeTime: async () =>
		(await import("@/lib/engagement/testing/all-employee-time")).allEmployeeTime(),
}));
vi.mock("next-intl/server", () => ({
	getLocale: vi.fn(async () => "en"),
}));

const JOB_IN_SCOPE = "11111111-1111-4111-8111-111111111111";
const JOB_OUT_OF_SCOPE = "22222222-2222-4222-8222-222222222222";
const JOB_ORG_WIDE = "33333333-3333-4333-8333-333333333333";

const mockState = vi.hoisted(() => ({
	authContext: null as {
		user: { id: string; email: string; name: string };
		session: { activeOrganizationId: string | null };
		employee: { id: string; organizationId: string; role: "admin" | "manager" | "employee" } | null;
	} | null,
	settingsCaller: null as {
		organizationId: string;
		settingsAccess: "member" | "scopedManager" | "orgAdmin" | "owner";
	} | null,
	hasGrant: false,
	grantScope: null as "all" | "specific" | null,
	grantEmployeeIds: [] as string[],
	orgEmployeeIds: ["emp-1", "emp-2", "emp-3"] as string[],
	exportJobs: [] as PayrollExportJobSummary[],
	carriedDayRows: [] as Array<{ jobId: string; employeeId: string }>,
	jobLookupRow: null as {
		id: string;
		organizationId: string;
		filters: PayrollExportJobSummary["filters"];
	} | null,
	getPayrollWorkspaceSummary: vi.fn(),
	getPayrollReadiness: vi.fn(),
	getExportDownloadUrl: vi.fn(),
	readPeriodForEmployees: vi.fn(),
	settleDays: vi.fn(),
	resolvePeriodEmployeeIds: vi.fn(),
	createExportJob: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: vi.fn((shape: Record<string, unknown>) => ({
			from: vi.fn(() => ({
				where: vi.fn(() => {
					if ("timezone" in shape) {
						return { limit: vi.fn(async () => [{ timezone: "Europe/Berlin" }]) };
					}
					if ("jobId" in shape && "employeeId" in shape) {
						return Promise.resolve(mockState.carriedDayRows);
					}
					if ("organizationId" in shape && "filters" in shape) {
						return {
							limit: vi.fn(async () => (mockState.jobLookupRow ? [mockState.jobLookupRow] : [])),
						};
					}
					return { limit: vi.fn(async () => []) };
				}),
			})),
		})),
		query: { payrollBlockerDismissal: { findFirst: vi.fn(async () => null) } },
		insert: vi.fn(),
	},
	payrollExportConfig: {},
	payrollExportFormat: {},
}));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(async () => mockState.authContext),
	getCurrentSettingsAccess: vi.fn(async () => mockState.settingsCaller),
	getAbility: vi.fn(async () => ({ can: () => false })),
}));

vi.mock("@/lib/payroll-access/permissions", () => ({
	hasActivePayrollAccessGrant: vi.fn(async () => mockState.hasGrant),
	getActivePayrollAccessGrantScope: vi.fn(async () => mockState.grantScope),
	resolveOrganizationPayrollEmployeeIds: vi.fn(async () => mockState.orgEmployeeIds),
	resolvePayrollAccessibleEmployeeIds: vi.fn(async () => mockState.grantEmployeeIds),
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
	listOrganizationDepartedEmployeesForExport: vi.fn(async () => []),
}));

vi.mock("@/lib/payroll-period/read-period", () => ({
	listDepartedGrantEmployees: vi.fn(async () => []),
	readPeriodForEmployees: mockState.readPeriodForEmployees,
	resolvePeriodEmployeeIds: mockState.resolvePeriodEmployeeIds,
}));

vi.mock("@/lib/payroll-period/settlement", () => ({
	MAX_SETTLE_SPECIFIC_DAYS: 5_000,
	previewSettleDays: vi.fn(),
	settleDays: mockState.settleDays,
	previewSettleSpecificDays: vi.fn(),
	settleSpecificDays: vi.fn(),
	settlementHistory: vi.fn(),
	unsettleDays: vi.fn(),
}));

vi.mock("@/lib/payroll-export", () => ({
	createExportJob: mockState.createExportJob,
	enqueuePayrollExportJob: vi.fn(),
	getExportDownloadUrl: mockState.getExportDownloadUrl,
	getExportJobHistory: vi.fn(async () => mockState.exportJobs),
	getFormatter: vi.fn(() => ({})),
	getPayrollExportConfig: vi.fn(async () => ({ config: { id: "cfg-1" } })),
	processExportJob: vi.fn(),
	unmappedOvertimePayoutsForExport: vi.fn(async () => []),
}));

vi.mock("@/lib/payroll-readiness/get-payroll-readiness", () => ({
	getPayrollReadiness: mockState.getPayrollReadiness,
}));

vi.mock("@/lib/payroll-workspace/summary", () => ({
	getPayrollWorkspaceSummary: mockState.getPayrollWorkspaceSummary,
}));

vi.mock("@/lib/payroll-workspace/pdf-exporter", () => ({
	exportPayrollPeriodToPDF: vi.fn(),
	generatePayrollPDFFilename: vi.fn(),
}));

vi.mock("@/lib/travel-expenses/payroll-run", () => ({
	listUnconfirmedPayrollRuns: vi.fn(async () => []),
	discardPayrollRun: vi.fn(),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));

const {
	dismissPayrollBlockerAction,
	getPayrollExportDownloadUrlAction,
	getPayrollExportHistoryAction,
	getPayrollPeriodAction,
	getPayrollReadinessForWorkspaceAction,
	getPayrollWorkspaceSummaryAction,
	settlePayrollDaysAction,
	startScopedPayrollExportAction,
} = await import("./actions");

const baseRequest = {
	startDate: "2026-06-01",
	endDate: "2026-06-30",
	label: "June 2026",
};

function makeJob(
	id: string,
	employeeIds?: string[],
): PayrollExportJobSummary {
	return {
		id,
		status: "completed",
		fileName: `${id}.csv`,
		fileSizeBytes: 512,
		workPeriodCount: 10,
		employeeCount: employeeIds?.length ?? 3,
		createdAt: new Date("2026-06-30T10:00:00.000Z"),
		completedAt: new Date("2026-06-30T10:01:00.000Z"),
		errorMessage: null,
		filters: {
			dateRange: { start: "2026-06-01", end: "2026-06-30" },
			...(employeeIds ? { employeeIds } : {}),
		},
		payrollRunIncludedReports: 0,
		unmappedOvertimePayoutCount: 0,
		settledDaysLeftOut: 0,
		includesSettledDays: false,
	};
}

describe("payroll actions access paths & scoped export history (#1957)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.authContext = null;
		mockState.settingsCaller = null;
		mockState.hasGrant = false;
		mockState.grantScope = null;
		mockState.grantEmployeeIds = [];
		mockState.orgEmployeeIds = ["emp-1", "emp-2", "emp-3"];
		mockState.exportJobs = [
			makeJob(JOB_IN_SCOPE, ["emp-1"]),
			makeJob(JOB_OUT_OF_SCOPE, ["emp-1", "emp-2"]),
			makeJob(JOB_ORG_WIDE),
		];
		mockState.carriedDayRows = [];
		mockState.jobLookupRow = null;
		mockState.getPayrollWorkspaceSummary.mockResolvedValue({
			organizationId: "org-1",
			organizationName: "Acme",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: "2026-06-30T12:00:00.000Z",
			generatedBy: { id: "user-admin", name: "Org Admin" },
			totals: { employeeCount: 3, totalWorkedHours: 24, blockerCount: 0 },
			employees: [],
			absenceDetails: [],
			blockers: [],
		});
		mockState.readPeriodForEmployees.mockResolvedValue({
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			employees: [],
			absences: [],
			settlement: { settledDays: 0, unsettledDays: 0, changedSinceSettledDays: 0 },
		});
		mockState.getPayrollReadiness.mockResolvedValue({
			status: "ready",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			summary: {
				blockerCount: 0,
				warningCount: 0,
				affectedEmployeeCount: 0,
				configuredExportTargetCount: 1,
			},
			groups: [],
		});
		mockState.getExportDownloadUrl.mockResolvedValue("https://downloads.example/export.csv");
		mockState.settleDays.mockResolvedValue({
			status: "settled",
			newlySettled: [],
			alreadySettled: [],
			inUnclosedMonths: [],
			skippedWithoutEntries: [],
			skippedPendingAbsences: [],
			skippedUnclosedMonths: [],
			withPendingAbsences: [],
			employees: [],
		});
		mockState.resolvePeriodEmployeeIds.mockImplementation(async () => mockState.grantEmployeeIds);
	});

	describe("Org admin WITH an employee record (no self-grant)", () => {
		beforeEach(() => {
			mockState.authContext = {
				user: { id: "user-admin", email: "admin@example.com", name: "Org Admin" },
				session: { activeOrganizationId: "org-1" },
				employee: { id: "emp-admin", organizationId: "org-1", role: "admin" },
			};
			mockState.settingsCaller = {
				organizationId: "org-1",
				settingsAccess: "orgAdmin",
			};
			mockState.hasGrant = false;
		});

		it("loads summary over the whole organization without requiring a payroll access grant", async () => {
			const result = await getPayrollWorkspaceSummaryAction(baseRequest);

			expect(result.success).toBe(true);
			expect(mockState.getPayrollWorkspaceSummary).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org-1",
					allowedEmployeeIds: ["emp-1", "emp-2", "emp-3"],
					generatedBy: { id: "emp-admin", name: "Org Admin" },
				}),
			);
		});

		it("returns org-level payroll readiness and full org export history", async () => {
			const readiness = await getPayrollReadinessForWorkspaceAction({
				startDate: "2026-06-01",
				endDate: "2026-06-30",
			});
			expect(readiness.success).toBe(true);
			expect(mockState.getPayrollReadiness).toHaveBeenCalledWith(
				expect.objectContaining({ organizationId: "org-1" }),
			);

			const history = await getPayrollExportHistoryAction();
			expect(history.success).toBe(true);
			if (history.success) {
				expect(history.data.organizationTimezone).toBe("Europe/Berlin");
				expect(history.data.exports.map((job) => job.id)).toEqual([
					JOB_IN_SCOPE,
					JOB_OUT_OF_SCOPE,
					JOB_ORG_WIDE,
				]);
			}
		});
	});

	describe("Org admin WITHOUT an employee record", () => {
		beforeEach(() => {
			mockState.authContext = {
				user: { id: "user-owner", email: "owner@example.com", name: "Owner Without Employee" },
				session: { activeOrganizationId: "org-1" },
				employee: null,
			};
			mockState.settingsCaller = {
				organizationId: "org-1",
				settingsAccess: "orgAdmin",
			};
			mockState.hasGrant = false;
		});

		it("supports summary, period, readiness, settlement, and export history with employee: null", async () => {
			const summary = await getPayrollWorkspaceSummaryAction(baseRequest);
			expect(summary.success).toBe(true);
			expect(mockState.getPayrollWorkspaceSummary).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org-1",
					allowedEmployeeIds: ["emp-1", "emp-2", "emp-3"],
					generatedBy: { id: "user-owner", name: "Owner Without Employee" },
				}),
			);

			const period = await getPayrollPeriodAction(baseRequest);
			expect(period.success).toBe(true);

			const readiness = await getPayrollReadinessForWorkspaceAction({
				startDate: "2026-06-01",
				endDate: "2026-06-30",
			});
			expect(readiness.success).toBe(true);

			const settled = await settlePayrollDaysAction(baseRequest);
			expect(settled.success).toBe(true);
			expect(mockState.settleDays).toHaveBeenCalledWith(
				"org-1",
				expect.objectContaining({
					employeeId: null,
					userId: "user-owner",
					orgAdmin: true,
				}),
				{ employeeIds: undefined },
				{ startDate: "2026-06-01", endDate: "2026-06-30" },
				{},
			);

			mockState.jobLookupRow = {
				id: JOB_ORG_WIDE,
				organizationId: "org-1",
				filters: { dateRange: { start: "2026-06-01", end: "2026-06-30" } },
			};
			const download = await getPayrollExportDownloadUrlAction(JOB_ORG_WIDE);
			expect(download).toEqual({
				success: true,
				data: "https://downloads.example/export.csv",
			});
		});

		it("returns a clean ValidationError instead of crashing when employee-FK writes lack an employee profile", async () => {
			const exportResult = await startScopedPayrollExportAction({
				...baseRequest,
				formatId: "datev_lohn",
			});
			expect(exportResult.success).toBe(false);
			if (!exportResult.success) {
				expect(exportResult.code).toBe("ValidationError");
			}
			expect(mockState.createExportJob).not.toHaveBeenCalled();

			const dismissResult = await dismissPayrollBlockerAction({
				...baseRequest,
				blockerId: "44444444-4444-4444-8444-444444444444",
				blockerType: "missing_clock_out",
			});
			expect(dismissResult.success).toBe(false);
			if (!dismissResult.success) {
				expect(dismissResult.code).toBe("ValidationError");
			}
		});
	});

	describe("Delegated payroll officer with specific grant scope", () => {
		beforeEach(() => {
			mockState.authContext = {
				user: { id: "user-officer", email: "officer@example.com", name: "Payroll Officer" },
				session: { activeOrganizationId: "org-1" },
				employee: { id: "emp-officer", organizationId: "org-1", role: "employee" },
			};
			mockState.settingsCaller = {
				organizationId: "org-1",
				settingsAccess: "member",
			};
			mockState.hasGrant = true;
			mockState.grantScope = "specific";
			mockState.grantEmployeeIds = ["emp-1"];
		});

		it("enforces exact grant scope on summary and refuses out-of-scope employee selection", async () => {
			const allowed = await getPayrollWorkspaceSummaryAction(baseRequest);
			expect(allowed.success).toBe(true);
			expect(mockState.getPayrollWorkspaceSummary).toHaveBeenCalledWith(
				expect.objectContaining({
					allowedEmployeeIds: ["emp-1"],
				}),
			);

			const denied = await getPayrollWorkspaceSummaryAction({
				...baseRequest,
				employeeIds: ["emp-2"],
			});
			expect(denied.success).toBe(false);
			if (!denied.success) {
				expect(denied.code).toBe("AuthorizationError");
			}
		});

		it("refuses org-level payroll readiness checks", async () => {
			const result = await getPayrollReadinessForWorkspaceAction({
				startDate: "2026-06-01",
				endDate: "2026-06-30",
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe("AuthorizationError");
			}
			expect(mockState.getPayrollReadiness).not.toHaveBeenCalled();
		});

		it("filters export history and download URLs strictly to jobs within grant scope", async () => {
			const history = await getPayrollExportHistoryAction();
			expect(history.success).toBe(true);
			if (history.success) {
				// Only JOB_IN_SCOPE (emp-1) is visible; JOB_OUT_OF_SCOPE (emp-1 + emp-2) and JOB_ORG_WIDE are hidden.
				expect(history.data.exports.map((job) => job.id)).toEqual([JOB_IN_SCOPE]);
			}

			mockState.jobLookupRow = {
				id: JOB_IN_SCOPE,
				organizationId: "org-1",
				filters: {
					dateRange: { start: "2026-06-01", end: "2026-06-30" },
					employeeIds: ["emp-1"],
				},
			};
			const allowedDownload = await getPayrollExportDownloadUrlAction(JOB_IN_SCOPE);
			expect(allowedDownload).toEqual({
				success: true,
				data: "https://downloads.example/export.csv",
			});

			mockState.jobLookupRow = {
				id: JOB_OUT_OF_SCOPE,
				organizationId: "org-1",
				filters: {
					dateRange: { start: "2026-06-01", end: "2026-06-30" },
					employeeIds: ["emp-1", "emp-2"],
				},
			};
			const deniedDownload = await getPayrollExportDownloadUrlAction(JOB_OUT_OF_SCOPE);
			expect(deniedDownload.success).toBe(false);
			if (!deniedDownload.success) {
				expect(deniedDownload.code).toBe("AuthorizationError");
			}

			mockState.jobLookupRow = {
				id: JOB_ORG_WIDE,
				organizationId: "org-1",
				filters: {
					dateRange: { start: "2026-06-01", end: "2026-06-30" },
				},
			};
			const deniedOrgWideDownload = await getPayrollExportDownloadUrlAction(JOB_ORG_WIDE);
			expect(deniedOrgWideDownload.success).toBe(false);
			if (!deniedOrgWideDownload.success) {
				expect(deniedOrgWideDownload.code).toBe("AuthorizationError");
			}
		});

		it("hides and refuses download when carried days stay in scope but job filters include an out-of-scope employee or unfiltered org-wide scope", async () => {
			// emp-2 had no carried work days (e.g. only absences/payouts), so carried = { emp-1 }
			// while filters.employeeIds = [emp-1, emp-2] or unfiltered org-wide.
			mockState.carriedDayRows = [
				{ jobId: JOB_IN_SCOPE, employeeId: "emp-1" },
				{ jobId: JOB_OUT_OF_SCOPE, employeeId: "emp-1" },
				{ jobId: JOB_ORG_WIDE, employeeId: "emp-1" },
			];

			const history = await getPayrollExportHistoryAction();
			expect(history.success).toBe(true);
			if (history.success) {
				expect(history.data.exports.map((job) => job.id)).toEqual([JOB_IN_SCOPE]);
			}

			mockState.jobLookupRow = {
				id: JOB_OUT_OF_SCOPE,
				organizationId: "org-1",
				filters: {
					dateRange: { start: "2026-06-01", end: "2026-06-30" },
					employeeIds: ["emp-1", "emp-2"],
				},
			};
			const deniedMixed = await getPayrollExportDownloadUrlAction(JOB_OUT_OF_SCOPE);
			expect(deniedMixed.success).toBe(false);
			if (!deniedMixed.success) {
				expect(deniedMixed.code).toBe("AuthorizationError");
			}

			mockState.jobLookupRow = {
				id: JOB_ORG_WIDE,
				organizationId: "org-1",
				filters: {
					dateRange: { start: "2026-06-01", end: "2026-06-30" },
				},
			};
			const deniedOrgWide = await getPayrollExportDownloadUrlAction(JOB_ORG_WIDE);
			expect(deniedOrgWide.success).toBe(false);
			if (!deniedOrgWide.success) {
				expect(deniedOrgWide.code).toBe("AuthorizationError");
			}
		});
	});

	describe("Close-month-only custom-role holder (no org admin, no payroll grant)", () => {
		beforeEach(() => {
			mockState.authContext = {
				user: { id: "user-closer", email: "closer@example.com", name: "Month Closer" },
				session: { activeOrganizationId: "org-1" },
				employee: { id: "emp-closer", organizationId: "org-1", role: "employee" },
			};
			mockState.settingsCaller = {
				organizationId: "org-1",
				settingsAccess: "member",
			};
			mockState.hasGrant = false;
			mockState.grantScope = null;
		});

		it("denies all restricted payroll workspace, readiness, settlement, and export actions", async () => {
			const results = await Promise.all([
				getPayrollWorkspaceSummaryAction(baseRequest),
				getPayrollPeriodAction(baseRequest),
				getPayrollReadinessForWorkspaceAction({
					startDate: "2026-06-01",
					endDate: "2026-06-30",
				}),
				getPayrollExportHistoryAction(),
				getPayrollExportDownloadUrlAction(JOB_IN_SCOPE),
				startScopedPayrollExportAction({ ...baseRequest, formatId: "datev_lohn" }),
				settlePayrollDaysAction(baseRequest),
			]);

			for (const result of results) {
				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.code).toBe("AuthorizationError");
				}
			}
		});

		it("returns AuthorizationError (not AuthenticationError) for an employee-less close-month-only user", async () => {
			mockState.authContext = {
				user: { id: "user-closer-no-emp", email: "closer2@example.com", name: "Closer No Emp" },
				session: { activeOrganizationId: "org-1" },
				employee: null,
			};

			const results = await Promise.all([
				getPayrollWorkspaceSummaryAction(baseRequest),
				getPayrollExportHistoryAction(),
				getPayrollReadinessForWorkspaceAction({
					startDate: "2026-06-01",
					endDate: "2026-06-30",
				}),
			]);

			for (const result of results) {
				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.code).toBe("AuthorizationError");
				}
			}
		});
	});
});
