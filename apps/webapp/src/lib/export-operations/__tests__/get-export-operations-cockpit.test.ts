import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findPayrollJobsByOccurrence: vi.fn(),
	findAuditRequestsByOccurrence: vi.fn(),
	getTranslate: vi.fn(
		async () =>
			(
				_key: string,
				defaultValue?: string,
				params?: Record<string, string | number>,
			) => {
				const template = defaultValue ?? _key;

				if (!params) {
					return template;
				}

				return Object.entries(params).reduce(
					(result, [paramKey, paramValue]) =>
						result.replaceAll(`{${paramKey}}`, String(paramValue)),
					template,
				);
			},
	),
	findPayrollFailuresLast7Days: vi.fn(),
	findLatestCompletedPayrollExports: vi.fn(),
	findScheduledExports: vi.fn(),
	findScheduledExecutions: vi.fn(),
	findScheduledFailuresLast7Days: vi.fn(),
	findAuditFailuresLast7Days: vi.fn(),
	findAuditExportPackages: vi.fn(),
	findLatestCompletedAuditPackages: vi.fn(),
}));

const payrollExportJobQuery = vi.hoisted(() =>
	vi.fn((input?: { columns?: { id?: boolean; completedAt?: boolean } }) => {
		if (input?.columns?.id) {
			return mockState.findPayrollFailuresLast7Days(input);
		}

		if (input?.columns?.completedAt) {
			return mockState.findLatestCompletedPayrollExports(input);
		}

		return mockState.findPayrollJobsByOccurrence(input);
	}),
);

const auditPackRequestQuery = vi.hoisted(() =>
	vi.fn((input?: { columns?: { id?: boolean } }) => {
		if (input?.columns?.id) {
			return mockState.findAuditFailuresLast7Days(input);
		}

		return mockState.findAuditRequestsByOccurrence(input);
	}),
);

const selectQuery = vi.hoisted(() =>
	vi.fn((shape: Record<string, unknown>) => ({
		from: () => ({
			where: () => ({
				orderBy: () => ({
					limit: () => {
						if ("fileName" in shape) {
							return mockState.findPayrollJobsByOccurrence();
						}

						return mockState.findAuditRequestsByOccurrence();
					},
				}),
			}),
		}),
	})),
);

const scheduledExecutionQuery = vi.hoisted(() =>
	vi.fn((input?: { limit?: number }) => {
		if (input?.limit === 25) {
			return mockState.findScheduledExecutions(input);
		}

		return mockState.findScheduledFailuresLast7Days(input);
	}),
);

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	asc: vi.fn((value: unknown) => ({ direction: "asc", value })),
	desc: vi.fn((value: unknown) => ({ direction: "desc", value })),
	eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
	gte: vi.fn((left: unknown, right: unknown) => ({ left, right, operator: ">=" })),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: mockState.getTranslate,
}));

vi.mock("@/db", () => ({
	db: {
		select: selectQuery,
		query: {
			payrollExportJob: {
				findMany: payrollExportJobQuery,
			},
			scheduledExport: {
				findMany: mockState.findScheduledExports,
			},
			scheduledExportExecution: {
				findMany: scheduledExecutionQuery,
			},
			auditPackRequest: {
				findMany: auditPackRequestQuery,
			},
			auditExportPackage: {
				findMany: vi.fn((input?: { limit?: number }) => {
					if (input?.limit === 10) {
						return mockState.findAuditExportPackages(input);
					}

					return mockState.findLatestCompletedAuditPackages(input);
				}),
			},
		},
	},
	payrollExportJob: {
		organizationId: "payrollExportJob.organizationId",
		status: "payrollExportJob.status",
		completedAt: "payrollExportJob.completedAt",
		createdAt: "payrollExportJob.createdAt",
	},
	scheduledExport: {
		organizationId: "scheduledExport.organizationId",
		nextExecutionAt: "scheduledExport.nextExecutionAt",
	},
	scheduledExportExecution: {
		organizationId: "scheduledExportExecution.organizationId",
		status: "scheduledExportExecution.status",
		triggeredAt: "scheduledExportExecution.triggeredAt",
	},
	auditPackRequest: {
		organizationId: "auditPackRequest.organizationId",
		status: "auditPackRequest.status",
		completedAt: "auditPackRequest.completedAt",
		createdAt: "auditPackRequest.createdAt",
	},
	auditExportPackage: {
		organizationId: "auditExportPackage.organizationId",
		status: "auditExportPackage.status",
		completedAt: "auditExportPackage.completedAt",
		createdAt: "auditExportPackage.createdAt",
	},
}));

describe("getExportOperationsCockpit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds alerts, upcoming runs, and recent activity from all export sources", async () => {
		mockState.findPayrollJobsByOccurrence.mockResolvedValue([
			{
				id: "payroll-job-pending",
				status: "pending",
				fileName: null,
				fileSizeBytes: null,
				workPeriodCount: null,
				employeeCount: null,
				createdAt: new Date("2026-04-11T11:30:00.000Z"),
				completedAt: null,
				errorMessage: null,
				filters: {},
			},
			{
				id: "payroll-job-completed-latest",
				status: "completed",
				fileName: "payroll-final.csv",
				fileSizeBytes: 4096,
				workPeriodCount: 18,
				employeeCount: 8,
				createdAt: new Date("2026-04-10T11:10:00.000Z"),
				completedAt: new Date("2026-04-10T11:12:00.000Z"),
				errorMessage: null,
				filters: {},
			},
			{
				id: "payroll-job-failed-late-completion",
				status: "failed",
				fileName: null,
				fileSizeBytes: null,
				workPeriodCount: null,
				employeeCount: null,
				createdAt: new Date("2026-04-08T07:00:00.000Z"),
				completedAt: new Date("2026-04-10T11:15:00.000Z"),
				errorMessage: "Payroll export worker crashed late",
				filters: {},
			},
			{
				id: "payroll-job-failed",
				status: "failed",
				fileName: null,
				fileSizeBytes: null,
				workPeriodCount: null,
				employeeCount: null,
				createdAt: new Date("2026-04-10T11:00:00.000Z"),
				completedAt: null,
				errorMessage: "DATEV connector timed out",
				filters: {},
			},
			{
				id: "payroll-job-completed",
				status: "completed",
				fileName: "payroll-april.csv",
				fileSizeBytes: 2048,
				workPeriodCount: 14,
				employeeCount: 6,
				createdAt: new Date("2026-04-09T09:00:00.000Z"),
				completedAt: new Date("2026-04-09T09:05:00.000Z"),
				errorMessage: null,
				filters: {},
			},
		]);

		mockState.findScheduledExports.mockResolvedValue([
			{
				id: "schedule-blocked",
				organizationId: "org-1",
				name: "Blocked payroll export",
				isActive: true,
				payrollConfigId: null,
				reportType: "payroll_export",
				nextExecutionAt: new Date("2026-04-12T08:00:00.000Z"),
				lastExecutionAt: new Date("2026-04-10T05:00:00.000Z"),
				createdAt: new Date("2026-04-01T08:00:00.000Z"),
				updatedAt: new Date("2026-04-10T05:00:00.000Z"),
			},
			{
				id: "schedule-overdue",
				organizationId: "org-1",
				name: "Overdue payroll sync",
				isActive: true,
				payrollConfigId: "config-2",
				reportType: "payroll_export",
				nextExecutionAt: new Date("2026-04-11T10:00:00.000Z"),
				lastExecutionAt: new Date("2026-04-10T07:00:00.000Z"),
				createdAt: new Date("2026-04-03T08:00:00.000Z"),
				updatedAt: new Date("2026-04-10T07:00:00.000Z"),
			},
			{
				id: "schedule-ready",
				organizationId: "org-1",
				name: "Weekly audit extract",
				isActive: true,
				payrollConfigId: "config-1",
				reportType: "audit_report",
				nextExecutionAt: new Date("2026-04-13T08:00:00.000Z"),
				lastExecutionAt: new Date("2026-04-09T05:00:00.000Z"),
				createdAt: new Date("2026-04-02T08:00:00.000Z"),
				updatedAt: new Date("2026-04-09T05:00:00.000Z"),
			},
		]);

		mockState.findScheduledExecutions.mockResolvedValue([
			{
				id: "scheduled-execution-completed-latest",
				scheduledExportId: "schedule-ready",
				organizationId: "org-1",
				triggeredAt: new Date("2026-04-10T10:40:00.000Z"),
				completedAt: new Date("2026-04-10T10:50:00.000Z"),
				status: "completed",
				errorMessage: null,
			},
			{
				id: "scheduled-execution-failed-late-completion",
				scheduledExportId: "schedule-ready",
				organizationId: "org-1",
				triggeredAt: new Date("2026-04-08T09:00:00.000Z"),
				completedAt: new Date("2026-04-10T10:20:00.000Z"),
				status: "failed",
				errorMessage: "Delayed scheduled export failure",
			},
			{
				id: "scheduled-execution-failed",
				scheduledExportId: "schedule-ready",
				organizationId: "org-1",
				triggeredAt: new Date("2026-04-10T10:00:00.000Z"),
				completedAt: null,
				status: "failed",
				errorMessage: "SMTP delivery failed",
			},
			{
				id: "scheduled-execution-completed",
				scheduledExportId: "schedule-ready",
				organizationId: "org-1",
				triggeredAt: new Date("2026-04-09T08:00:00.000Z"),
				completedAt: new Date("2026-04-09T08:05:00.000Z"),
				status: "completed",
				errorMessage: null,
			},
		]);

		mockState.findPayrollFailuresLast7Days.mockResolvedValue([
			{ id: "scheduled-payroll-job-1" },
			{ id: "payroll-failure-2" },
			{ id: "payroll-failure-completed-late" },
		]);
		mockState.findLatestCompletedPayrollExports.mockResolvedValue([
			{
				id: "payroll-job-completed-older-created",
				completedAt: new Date("2026-04-09T09:30:00.000Z"),
			},
		]);
		mockState.findScheduledFailuresLast7Days.mockResolvedValue([
			{
				id: "scheduled-failure-completed-late",
				underlyingJobId: null,
				underlyingJobType: null,
			},
			{
				id: "scheduled-failure-1",
				underlyingJobId: "scheduled-payroll-job-1",
				underlyingJobType: "payroll_export",
			},
			{ id: "scheduled-failure-2" },
			{ id: "scheduled-failure-3" },
		]);
		mockState.findAuditFailuresLast7Days.mockResolvedValue([
			{ id: "audit-failure-1" },
			{ id: "audit-failure-completed-late" },
		]);

		mockState.findAuditRequestsByOccurrence.mockResolvedValue([
			{
				id: "audit-request-completed-latest",
				organizationId: "org-1",
				status: "completed",
				createdAt: new Date("2026-04-10T10:16:00.000Z"),
				completedAt: new Date("2026-04-10T10:25:00.000Z"),
				errorMessage: null,
				artifact: null,
			},
			{
				id: "audit-request-failed-late-completion",
				organizationId: "org-1",
				status: "failed",
				createdAt: new Date("2026-04-08T05:00:00.000Z"),
				completedAt: new Date("2026-04-10T10:15:00.000Z"),
				errorMessage: "Late audit hardening failure",
				artifact: null,
			},
			{
				id: "audit-request-failed",
				organizationId: "org-1",
				status: "failed",
				createdAt: new Date("2026-04-10T06:00:00.000Z"),
				completedAt: new Date("2026-04-10T06:05:00.000Z"),
				errorMessage: "Audit bundle assembly failed",
				artifact: null,
			},
			{
				id: "audit-request-completed",
				organizationId: "org-1",
				status: "completed",
				createdAt: new Date("2026-04-08T06:00:00.000Z"),
				completedAt: new Date("2026-04-08T06:10:00.000Z"),
				errorMessage: null,
				artifact: null,
			},
		]);

		mockState.findAuditExportPackages.mockResolvedValue([
			{
				id: "audit-package-pending",
				organizationId: "org-1",
				status: "pending",
				createdAt: new Date("2026-04-10T08:00:00.000Z"),
				completedAt: null,
			},
			{
				id: "audit-package-1",
				organizationId: "org-1",
				status: "completed",
				createdAt: new Date("2026-04-08T06:00:00.000Z"),
				completedAt: new Date("2026-04-08T06:10:00.000Z"),
			},
		]);
		mockState.findLatestCompletedAuditPackages.mockResolvedValue([
			{
				id: "audit-package-completed-older-created",
				completedAt: new Date("2026-04-10T09:15:00.000Z"),
			},
		]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(mockState.findPayrollJobsByOccurrence).toHaveBeenCalledTimes(1);
		expect(mockState.findAuditRequestsByOccurrence).toHaveBeenCalledTimes(1);
		expect(mockState.findScheduledExports).toHaveBeenCalledTimes(1);
		expect(mockState.findScheduledExecutions).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
		expect(mockState.findAuditExportPackages).not.toHaveBeenCalled();
		expect(mockState.findPayrollFailuresLast7Days).toHaveBeenCalledTimes(1);
		expect(mockState.findLatestCompletedPayrollExports).toHaveBeenCalledTimes(1);
		expect(mockState.findScheduledFailuresLast7Days).toHaveBeenCalledTimes(1);
		expect(mockState.findAuditFailuresLast7Days).toHaveBeenCalledTimes(1);
		expect(mockState.findLatestCompletedAuditPackages).toHaveBeenCalledTimes(1);

		expect(result.summary).toEqual({
			activeSchedules: 3,
			failedRunsLast7Days: 8,
			lastPayrollExportAt: new Date("2026-04-09T09:30:00.000Z"),
			lastAuditPackageAt: new Date("2026-04-10T09:15:00.000Z"),
		});
		expect(result.errors).toEqual({
			summary: null,
			alerts: null,
			upcomingRuns: null,
			recentActivity: null,
		});

		expect(result.alerts).toEqual([
			expect.objectContaining({
				id: "schedule-blocked",
				source: "scheduled",
				severity: "warning",
				description:
					"Blocked payroll export needs a payroll export configuration before it can run.",
				href: "/settings/scheduled-exports",
			}),
		]);
		expect(result.alerts).toHaveLength(1);

		expect(result.upcomingRuns).toEqual([
			expect.objectContaining({
				id: "schedule-ready",
				name: "Weekly audit extract",
				source: "scheduled",
				href: "/settings/scheduled-exports",
			}),
		]);
		expect(result.upcomingRuns).toHaveLength(1);

		expect(result.recentActivity.map((item) => item.id)).toEqual([
			"payroll-job-pending",
			"payroll-job-failed-late-completion",
			"payroll-job-completed-latest",
			"payroll-job-failed",
			"scheduled-execution-completed-latest",
			"audit-request-completed-latest",
			"scheduled-execution-failed-late-completion",
			"audit-request-failed-late-completion",
			"scheduled-execution-failed",
			"audit-request-failed",
			"payroll-job-completed",
			"scheduled-execution-completed",
			"audit-request-completed",
		]);
		expect(result.recentActivity).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "payroll-job-failed-late-completion",
					source: "payroll",
					status: "failed",
					href: "/settings/payroll-export",
				}),
				expect.objectContaining({
					id: "scheduled-execution-failed-late-completion",
					source: "scheduled",
					status: "failed",
					href: "/settings/scheduled-exports",
				}),
				expect.objectContaining({
					id: "audit-request-failed-late-completion",
					source: "audit",
					status: "failed",
					href: "/settings/audit-export",
				}),
			]),
		);
	});

	it("keeps payroll results visible when scheduled export sources fail", async () => {
		mockState.findPayrollJobsByOccurrence.mockResolvedValue([
			{
				id: "payroll-job-failed",
				status: "failed",
				fileName: null,
				fileSizeBytes: null,
				workPeriodCount: null,
				employeeCount: null,
				createdAt: new Date("2026-04-10T11:00:00.000Z"),
				completedAt: null,
				errorMessage: "DATEV connector timed out",
				filters: {},
			},
		]);
		mockState.findScheduledExports.mockRejectedValue(new Error("scheduled exports unavailable"));
		mockState.findScheduledExecutions.mockRejectedValue(new Error("scheduled executions unavailable"));
		mockState.findPayrollFailuresLast7Days.mockResolvedValue([{ id: "payroll-failure-1" }]);
		mockState.findLatestCompletedPayrollExports.mockResolvedValue([]);
		mockState.findScheduledFailuresLast7Days.mockRejectedValue(
			new Error("scheduled failure counts unavailable"),
		);
		mockState.findAuditRequestsByOccurrence.mockResolvedValue([]);
		mockState.findAuditFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditExportPackages.mockResolvedValue([]);
		mockState.findLatestCompletedAuditPackages.mockResolvedValue([]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.summary).toEqual({
			activeSchedules: 0,
			failedRunsLast7Days: 1,
			lastPayrollExportAt: null,
			lastAuditPackageAt: null,
		});
		expect(result.errors).toEqual({
			summary: "Counts are based on the export data that could be loaded.",
			alerts: "Some alerts may be incomplete while export data is unavailable.",
			upcomingRuns: "Scheduled export data is temporarily unavailable.",
			recentActivity: "Some activity data is temporarily unavailable.",
		});
		expect(result.upcomingRuns).toEqual([]);
		expect(result.alerts).toEqual([
			expect.objectContaining({
				id: "payroll-job-failed",
				source: "payroll",
				href: "/settings/payroll-export",
			}),
		]);
		expect(result.recentActivity).toEqual([
			expect.objectContaining({
				id: "payroll-job-failed",
				source: "payroll",
				status: "failed",
				href: "/settings/payroll-export",
			}),
		]);
	});

	it("marks alerts degraded when scheduled execution data is unavailable", async () => {
		mockState.findPayrollJobsByOccurrence.mockResolvedValue([]);
		mockState.findPayrollFailuresLast7Days.mockResolvedValue([]);
		mockState.findLatestCompletedPayrollExports.mockResolvedValue([]);
		mockState.findScheduledExports.mockResolvedValue([
			{
				id: "schedule-ready",
				organizationId: "org-1",
				name: "Weekly audit extract",
				isActive: true,
				payrollConfigId: "config-1",
				reportType: "audit_report",
				nextExecutionAt: new Date("2026-04-13T08:00:00.000Z"),
				lastExecutionAt: new Date("2026-04-09T05:00:00.000Z"),
				createdAt: new Date("2026-04-02T08:00:00.000Z"),
				updatedAt: new Date("2026-04-09T05:00:00.000Z"),
			},
		]);
		mockState.findScheduledExecutions.mockRejectedValue(new Error("scheduled executions unavailable"));
		mockState.findScheduledFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditRequestsByOccurrence.mockResolvedValue([]);
		mockState.findAuditFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditExportPackages.mockResolvedValue([]);
		mockState.findLatestCompletedAuditPackages.mockResolvedValue([]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.errors.alerts).toBe(
			"Some alerts may be incomplete while export data is unavailable.",
		);
	});

	it("does not mark summary degraded when only recent activity sources fail", async () => {
		mockState.findPayrollJobsByOccurrence.mockResolvedValue([
			{
				id: "payroll-job-completed",
				status: "completed",
				fileName: "payroll-april.csv",
				fileSizeBytes: 2048,
				workPeriodCount: 14,
				employeeCount: 6,
				createdAt: new Date("2026-04-10T11:00:00.000Z"),
				completedAt: new Date("2026-04-10T11:05:00.000Z"),
				errorMessage: null,
				filters: {},
			},
		]);
		mockState.findPayrollFailuresLast7Days.mockResolvedValue([]);
		mockState.findLatestCompletedPayrollExports.mockResolvedValue([
			{
				id: "payroll-job-completed",
				completedAt: new Date("2026-04-10T11:05:00.000Z"),
			},
		]);
		mockState.findScheduledExports.mockResolvedValue([
			{
				id: "schedule-ready",
				organizationId: "org-1",
				name: "Weekly audit extract",
				isActive: true,
				payrollConfigId: "config-1",
				reportType: "audit_report",
				nextExecutionAt: new Date("2026-04-13T08:00:00.000Z"),
				lastExecutionAt: new Date("2026-04-09T05:00:00.000Z"),
				createdAt: new Date("2026-04-02T08:00:00.000Z"),
				updatedAt: new Date("2026-04-09T05:00:00.000Z"),
			},
		]);
		mockState.findScheduledExecutions.mockRejectedValue(
			new Error("scheduled executions unavailable"),
		);
		mockState.findScheduledFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditRequestsByOccurrence.mockRejectedValue(new Error("audit requests unavailable"));
		mockState.findAuditFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditExportPackages.mockResolvedValue([
			{
				id: "audit-package-1",
				organizationId: "org-1",
				status: "completed",
				createdAt: new Date("2026-04-08T06:00:00.000Z"),
				completedAt: new Date("2026-04-08T06:10:00.000Z"),
			},
		]);
		mockState.findLatestCompletedAuditPackages.mockResolvedValue([
			{
				id: "audit-package-1",
				completedAt: new Date("2026-04-08T06:10:00.000Z"),
			},
		]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.summary).toEqual({
			activeSchedules: 1,
			failedRunsLast7Days: 0,
			lastPayrollExportAt: new Date("2026-04-10T11:05:00.000Z"),
			lastAuditPackageAt: new Date("2026-04-08T06:10:00.000Z"),
		});
		expect(result.errors).toEqual({
			summary: null,
			alerts: "Some alerts may be incomplete while export data is unavailable.",
			upcomingRuns: null,
			recentActivity: "Some activity data is temporarily unavailable.",
		});
	});

	it("returns null summary timestamps when no successful payroll or audit export exists", async () => {
		mockState.findPayrollJobsByOccurrence.mockResolvedValue([
			{
				id: "payroll-job-pending",
				status: "pending",
				fileName: null,
				fileSizeBytes: null,
				workPeriodCount: null,
				employeeCount: null,
				createdAt: new Date("2026-04-11T11:30:00.000Z"),
				completedAt: null,
				errorMessage: null,
				filters: {},
			},
			{
				id: "payroll-job-failed",
				status: "failed",
				fileName: null,
				fileSizeBytes: null,
				workPeriodCount: null,
				employeeCount: null,
				createdAt: new Date("2026-04-10T11:00:00.000Z"),
				completedAt: null,
				errorMessage: "DATEV connector timed out",
				filters: {},
			},
		]);
		mockState.findPayrollFailuresLast7Days.mockResolvedValue([{ id: "payroll-failure-1" }]);
		mockState.findLatestCompletedPayrollExports.mockResolvedValue([]);
		mockState.findScheduledExports.mockResolvedValue([]);
		mockState.findScheduledExecutions.mockResolvedValue([]);
		mockState.findScheduledFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditRequestsByOccurrence.mockResolvedValue([]);
		mockState.findAuditFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditExportPackages.mockResolvedValue([
			{
				id: "audit-package-pending",
				organizationId: "org-1",
				status: "pending",
				createdAt: new Date("2026-04-10T08:00:00.000Z"),
				completedAt: null,
			},
			{
				id: "audit-package-failed",
				organizationId: "org-1",
				status: "failed",
				createdAt: new Date("2026-04-09T08:00:00.000Z"),
				completedAt: null,
			},
		]);
		mockState.findLatestCompletedAuditPackages.mockResolvedValue([]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.summary.lastPayrollExportAt).toBeNull();
		expect(result.summary.lastAuditPackageAt).toBeNull();
	});

	it("uses latest completion timestamps instead of latest creation timestamps", async () => {
		mockState.findPayrollJobsByOccurrence.mockResolvedValue([]);
		mockState.findPayrollFailuresLast7Days.mockResolvedValue([]);
		mockState.findLatestCompletedPayrollExports.mockResolvedValue([
			{
				id: "payroll-job-created-earlier-finished-later",
				completedAt: new Date("2026-04-11T09:30:00.000Z"),
			},
		]);
		mockState.findScheduledExports.mockResolvedValue([]);
		mockState.findScheduledExecutions.mockResolvedValue([]);
		mockState.findScheduledFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditRequestsByOccurrence.mockResolvedValue([]);
		mockState.findAuditFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditExportPackages.mockResolvedValue([]);
		mockState.findLatestCompletedAuditPackages.mockResolvedValue([
			{
				id: "audit-package-created-earlier-finished-later",
				completedAt: new Date("2026-04-11T08:45:00.000Z"),
			},
		]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.summary.lastPayrollExportAt).toEqual(new Date("2026-04-11T09:30:00.000Z"));
		expect(result.summary.lastAuditPackageAt).toEqual(new Date("2026-04-11T08:45:00.000Z"));
	});
});
