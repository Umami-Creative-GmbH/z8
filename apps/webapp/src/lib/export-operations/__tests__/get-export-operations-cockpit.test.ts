import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getExportJobHistory: vi.fn(),
	listAuditPackRequests: vi.fn(),
	findPayrollFailuresLast7Days: vi.fn(),
	findScheduledExports: vi.fn(),
	findScheduledExecutions: vi.fn(),
	findScheduledFailuresLast7Days: vi.fn(),
	findAuditFailuresLast7Days: vi.fn(),
	findAuditExportPackages: vi.fn(),
}));

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
}));

vi.mock("@/lib/payroll-export", () => ({
	getExportJobHistory: mockState.getExportJobHistory,
}));

vi.mock("@/lib/audit-pack/application/request-repository", () => ({
	auditPackRequestRepository: {
		listRequests: mockState.listAuditPackRequests,
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			payrollExportJob: {
				findMany: mockState.findPayrollFailuresLast7Days,
			},
			scheduledExport: {
				findMany: mockState.findScheduledExports,
			},
			scheduledExportExecution: {
				findMany: scheduledExecutionQuery,
			},
			auditPackRequest: {
				findMany: mockState.findAuditFailuresLast7Days,
			},
			auditExportPackage: {
				findMany: mockState.findAuditExportPackages,
			},
		},
	},
	payrollExportJob: {
		organizationId: "payrollExportJob.organizationId",
		status: "payrollExportJob.status",
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
		createdAt: "auditPackRequest.createdAt",
	},
	auditExportPackage: {
		organizationId: "auditExportPackage.organizationId",
		createdAt: "auditExportPackage.createdAt",
	},
}));

describe("getExportOperationsCockpit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds alerts, upcoming runs, and recent activity from all export sources", async () => {
		mockState.getExportJobHistory.mockResolvedValue([
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
				id: "scheduled-execution-failed",
				scheduledExportId: "schedule-ready",
				organizationId: "org-1",
				triggeredAt: new Date("2026-04-10T10:00:00.000Z"),
				status: "failed",
				errorMessage: "SMTP delivery failed",
			},
			{
				id: "scheduled-execution-completed",
				scheduledExportId: "schedule-ready",
				organizationId: "org-1",
				triggeredAt: new Date("2026-04-09T08:00:00.000Z"),
				status: "completed",
				errorMessage: null,
			},
		]);

		mockState.findPayrollFailuresLast7Days.mockResolvedValue([
			{ id: "scheduled-payroll-job-1" },
			{ id: "payroll-failure-2" },
		]);
		mockState.findScheduledFailuresLast7Days.mockResolvedValue([
			{
				id: "scheduled-failure-1",
				underlyingJobId: "scheduled-payroll-job-1",
				underlyingJobType: "payroll_export",
			},
			{ id: "scheduled-failure-2" },
			{ id: "scheduled-failure-3" },
		]);
		mockState.findAuditFailuresLast7Days.mockResolvedValue([{ id: "audit-failure-1" }]);

		mockState.listAuditPackRequests.mockResolvedValue([
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
				id: "audit-package-1",
				organizationId: "org-1",
				status: "completed",
				createdAt: new Date("2026-04-08T06:10:00.000Z"),
			},
		]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(mockState.getExportJobHistory).toHaveBeenCalledWith("org-1");
		expect(mockState.listAuditPackRequests).toHaveBeenCalledWith({ organizationId: "org-1", limit: 10 });
		expect(mockState.findScheduledExports).toHaveBeenCalledTimes(1);
		expect(mockState.findScheduledExecutions).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
		expect(mockState.findAuditExportPackages).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
		expect(mockState.findPayrollFailuresLast7Days).toHaveBeenCalledTimes(1);
		expect(mockState.findScheduledFailuresLast7Days).toHaveBeenCalledTimes(1);
		expect(mockState.findAuditFailuresLast7Days).toHaveBeenCalledTimes(1);

		expect(result.summary).toEqual({
			activeSchedules: 3,
			failedRunsLast7Days: 5,
			lastPayrollExportAt: new Date("2026-04-10T11:00:00.000Z"),
			lastAuditPackageAt: new Date("2026-04-08T06:10:00.000Z"),
			error: null,
		});
		expect(result.alertsError).toBeNull();
		expect(result.upcomingRunsError).toBeNull();
		expect(result.recentActivityError).toBeNull();

		expect(result.alerts).toEqual([
			expect.objectContaining({
				id: "payroll-job-failed",
				source: "payroll",
				severity: "error",
				href: "/settings/payroll-export",
			}),
			expect.objectContaining({
				id: "schedule-blocked",
				source: "scheduled",
				severity: "warning",
				href: "/settings/scheduled-exports",
			}),
			expect.objectContaining({
				id: "audit-request-failed",
				source: "audit",
				severity: "error",
				href: "/settings/audit-export",
			}),
		]);

		expect(result.upcomingRuns).toEqual([
			expect.objectContaining({
				id: "schedule-blocked",
				name: "Blocked payroll export",
				source: "scheduled",
				href: "/settings/scheduled-exports",
			}),
			expect.objectContaining({
				id: "schedule-ready",
				name: "Weekly audit extract",
				source: "scheduled",
				href: "/settings/scheduled-exports",
			}),
		]);
		expect(result.upcomingRuns).toHaveLength(2);

		expect(result.recentActivity.map((item) => item.id)).toEqual([
			"payroll-job-failed",
			"scheduled-execution-failed",
			"audit-request-failed",
			"payroll-job-completed",
			"scheduled-execution-completed",
			"audit-request-completed",
		]);
		expect(result.recentActivity).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "payroll-job-failed",
					source: "payroll",
					status: "failed",
					href: "/settings/payroll-export",
				}),
				expect.objectContaining({
					id: "scheduled-execution-failed",
					source: "scheduled",
					status: "failed",
					href: "/settings/scheduled-exports",
				}),
				expect.objectContaining({
					id: "audit-request-failed",
					source: "audit",
					status: "failed",
					href: "/settings/audit-export",
				}),
			]),
		);
	});

	it("keeps payroll results visible when scheduled export sources fail", async () => {
		mockState.getExportJobHistory.mockResolvedValue([
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
		mockState.findScheduledFailuresLast7Days.mockRejectedValue(
			new Error("scheduled failure counts unavailable"),
		);
		mockState.findAuditFailuresLast7Days.mockResolvedValue([]);
		mockState.listAuditPackRequests.mockResolvedValue([]);
		mockState.findAuditExportPackages.mockResolvedValue([]);

		const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");
		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.summary).toEqual({
			activeSchedules: 0,
			failedRunsLast7Days: 1,
			lastPayrollExportAt: new Date("2026-04-10T11:00:00.000Z"),
			lastAuditPackageAt: null,
			error: "Counts are based on the export data that could be loaded.",
		});
		expect(result.alertsError).toBe(
			"Some alerts may be incomplete while export data is unavailable.",
		);
		expect(result.upcomingRuns).toEqual([]);
		expect(result.upcomingRunsError).toBe("Scheduled export data is temporarily unavailable.");
		expect(result.recentActivityError).toBe("Some activity data is temporarily unavailable.");
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

	it("does not mark summary degraded when only recent activity sources fail", async () => {
		mockState.getExportJobHistory.mockResolvedValue([
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
		mockState.listAuditPackRequests.mockRejectedValue(new Error("audit requests unavailable"));
		mockState.findAuditFailuresLast7Days.mockResolvedValue([]);
		mockState.findAuditExportPackages.mockResolvedValue([
			{
				id: "audit-package-1",
				organizationId: "org-1",
				status: "completed",
				createdAt: new Date("2026-04-08T06:10:00.000Z"),
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
			error: null,
		});
		expect(result.alertsError).toBe("Some alerts may be incomplete while export data is unavailable.");
		expect(result.upcomingRunsError).toBeNull();
		expect(result.recentActivityError).toBe(
			"Some activity data is temporarily unavailable.",
		);
	});
});
