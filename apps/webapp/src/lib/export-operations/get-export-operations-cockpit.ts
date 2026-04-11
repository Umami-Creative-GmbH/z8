import { DateTime } from "luxon";
import { and, asc, desc, eq, gte } from "drizzle-orm";

import {
	auditPackRequest,
	auditExportPackage,
	db,
	payrollExportJob,
	scheduledExport,
	scheduledExportExecution,
} from "@/db";
import { auditPackRequestRepository } from "@/lib/audit-pack/application/request-repository";
import { getExportJobHistory, type PayrollExportJobSummary } from "@/lib/payroll-export";
import { getTranslate } from "@/tolgee/server";

type ScheduledExportRecord = Awaited<ReturnType<typeof db.query.scheduledExport.findMany>>[number];
type ScheduledExecutionRecord = Awaited<
	ReturnType<typeof db.query.scheduledExportExecution.findMany>
>[number];
type AuditRequestRecord = Awaited<
	ReturnType<typeof auditPackRequestRepository.listRequests>
>[number];
type PayrollFailureCountRecord = { id: string };
type LatestCompletedPayrollExportRecord = { completedAt: Date | null };
type ScheduledFailureCountRecord = {
	id: string;
	underlyingJobId: string | null;
	underlyingJobType: string | null;
};
type AuditFailureCountRecord = { id: string };
type LatestCompletedAuditPackageRecord = { completedAt: Date | null };
type TranslateFn = Awaited<ReturnType<typeof getTranslate>>;

export interface ExportOperationsCoverageSummary {
	activeSchedules: number;
	failedRunsLast7Days: number;
	lastPayrollExportAt: Date | null;
	lastAuditPackageAt: Date | null;
}

export interface ExportOperationsCockpitErrors {
	summary: string | null;
	alerts: string | null;
	upcomingRuns: string | null;
	recentActivity: string | null;
}

export interface ExportOperationsAlert {
	id: string;
	source: "payroll" | "scheduled" | "audit";
	severity: "error" | "warning";
	title: string;
	description: string;
	occurredAt: Date;
	href: "/settings/payroll-export" | "/settings/scheduled-exports" | "/settings/audit-export";
}

export interface ExportOperationsUpcomingRun {
	id: string;
	source: "scheduled";
	name: string;
	scheduledFor: Date;
	href: "/settings/scheduled-exports";
}

export interface ExportOperationsActivityItem {
	id: string;
	source: "payroll" | "scheduled" | "audit";
	status: string;
	title: string;
	description: string;
	occurredAt: Date;
	href: "/settings/payroll-export" | "/settings/scheduled-exports" | "/settings/audit-export";
}

export interface ExportOperationsCockpitData {
	summary: ExportOperationsCoverageSummary;
	alerts: ExportOperationsAlert[];
	upcomingRuns: ExportOperationsUpcomingRun[];
	recentActivity: ExportOperationsActivityItem[];
	errors: ExportOperationsCockpitErrors;
}

export async function getExportOperationsCockpit(
	organizationId: string,
	now: DateTime = DateTime.utc(),
): Promise<ExportOperationsCockpitData> {
	const tPromise = getTranslate();
	const [
		payrollJobsResult,
		payrollFailuresLast7DaysResult,
		latestCompletedPayrollExportsResult,
		scheduledExportsResult,
		scheduledExecutionsResult,
		scheduledFailuresLast7DaysResult,
		auditRequestsResult,
		auditFailuresLast7DaysResult,
		latestCompletedAuditPackagesResult,
	] = await Promise.allSettled([
		getExportJobHistory(organizationId),
		db.query.payrollExportJob.findMany({
			where: and(
				eq(payrollExportJob.organizationId, organizationId),
				eq(payrollExportJob.status, "failed"),
				gte(payrollExportJob.completedAt, now.minus({ days: 7 }).toJSDate()),
			),
			columns: { id: true },
		}),
		db.query.payrollExportJob.findMany({
			where: and(
				eq(payrollExportJob.organizationId, organizationId),
				eq(payrollExportJob.status, "completed"),
			),
			orderBy: [desc(payrollExportJob.completedAt)],
			limit: 1,
			columns: { completedAt: true },
		}),
		db.query.scheduledExport.findMany({
			where: eq(scheduledExport.organizationId, organizationId),
			orderBy: [asc(scheduledExport.nextExecutionAt)],
		}),
			db.query.scheduledExportExecution.findMany({
			where: eq(scheduledExportExecution.organizationId, organizationId),
			orderBy: [desc(scheduledExportExecution.triggeredAt)],
			limit: 25,
		}),
		db.query.scheduledExportExecution.findMany({
			where: and(
				eq(scheduledExportExecution.organizationId, organizationId),
				eq(scheduledExportExecution.status, "failed"),
				gte(scheduledExportExecution.triggeredAt, now.minus({ days: 7 }).toJSDate()),
			),
			columns: {
				id: true,
				underlyingJobId: true,
				underlyingJobType: true,
			},
		}),
		auditPackRequestRepository.listRequests({ organizationId, limit: 10 }),
		db.query.auditPackRequest.findMany({
			where: and(
				eq(auditPackRequest.organizationId, organizationId),
				eq(auditPackRequest.status, "failed"),
				gte(auditPackRequest.completedAt, now.minus({ days: 7 }).toJSDate()),
			),
			columns: { id: true },
		}),
		db.query.auditExportPackage.findMany({
			where: and(
				eq(auditExportPackage.organizationId, organizationId),
				eq(auditExportPackage.status, "completed"),
			),
			orderBy: [desc(auditExportPackage.completedAt)],
			limit: 1,
			columns: { completedAt: true },
		}),
	]);

	const payrollJobs = getSettledValue(payrollJobsResult);
	const payrollFailuresLast7Days = getSettledValue<PayrollFailureCountRecord[]>(
		payrollFailuresLast7DaysResult,
	);
	const latestCompletedPayrollExports = getSettledValue<LatestCompletedPayrollExportRecord[]>(
		latestCompletedPayrollExportsResult,
	);
	const scheduledExports = getSettledValue(scheduledExportsResult);
	const scheduledExecutions = getSettledValue(scheduledExecutionsResult);
	const scheduledFailuresLast7Days = getSettledValue<ScheduledFailureCountRecord[]>(
		scheduledFailuresLast7DaysResult,
	);
	const auditRequests = getSettledValue(auditRequestsResult);
	const auditFailuresLast7Days = getSettledValue<AuditFailureCountRecord[]>(
		auditFailuresLast7DaysResult,
	);
	const latestCompletedAuditPackages = getSettledValue<LatestCompletedAuditPackageRecord[]>(
		latestCompletedAuditPackagesResult,
	);
	const t = await tPromise;

	const scheduledExportsById = new Map(scheduledExports.map((item) => [item.id, item]));

	const alerts = buildAlerts(payrollJobs, scheduledExports, auditRequests, t);
	const upcomingRuns = buildUpcomingRuns(scheduledExports, now);
	const recentActivity = buildRecentActivity(
		payrollJobs,
		scheduledExecutions,
		auditRequests,
		scheduledExportsById,
		t,
	);

	const summary: ExportOperationsCoverageSummary = {
		activeSchedules: scheduledExports.filter((schedule) => schedule.isActive).length,
		failedRunsLast7Days: countFailedRunsLast7Days(
			payrollFailuresLast7Days,
			scheduledFailuresLast7Days,
			auditFailuresLast7Days,
		),
		lastPayrollExportAt: getLastPayrollExportAt(latestCompletedPayrollExports),
		lastAuditPackageAt: getLastAuditPackageAt(latestCompletedAuditPackages),
	};

	return {
		summary,
		alerts,
		upcomingRuns,
		recentActivity,
		errors: {
			summary:
				payrollFailuresLast7DaysResult.status === "rejected" ||
				latestCompletedPayrollExportsResult.status === "rejected" ||
				scheduledExportsResult.status === "rejected" ||
				scheduledFailuresLast7DaysResult.status === "rejected" ||
				auditFailuresLast7DaysResult.status === "rejected" ||
				latestCompletedAuditPackagesResult.status === "rejected"
					? t(
						"settings.exportOperations.errors.summary",
						"Counts are based on the export data that could be loaded.",
					)
					: null,
			alerts:
				payrollJobsResult.status === "rejected" ||
				scheduledExportsResult.status === "rejected" ||
				auditRequestsResult.status === "rejected"
					? t(
						"settings.exportOperations.errors.alerts",
						"Some alerts may be incomplete while export data is unavailable.",
					)
					: null,
			upcomingRuns:
				scheduledExportsResult.status === "rejected"
					? t(
						"settings.exportOperations.errors.upcomingRuns",
						"Scheduled export data is temporarily unavailable.",
					)
					: null,
			recentActivity:
				payrollJobsResult.status === "rejected" ||
				scheduledExecutionsResult.status === "rejected" ||
				auditRequestsResult.status === "rejected"
					? t(
						"settings.exportOperations.errors.recentActivity",
						"Some activity data is temporarily unavailable.",
					)
					: null,
		},
	};
}

function getSettledValue<T>(result: PromiseSettledResult<T>): T extends Array<infer U> ? U[] : T {
	if (result.status === "fulfilled") {
		return result.value as T extends Array<infer U> ? U[] : T;
	}

	return [] as T extends Array<infer U> ? U[] : T;
}

function buildAlerts(
	payrollJobs: PayrollExportJobSummary[],
	scheduledExports: ScheduledExportRecord[],
	auditRequests: AuditRequestRecord[],
	t: TranslateFn,
): ExportOperationsAlert[] {
	const alerts: ExportOperationsAlert[] = [];
	const latestFailedPayrollJob = payrollJobs.find((job) => job.status === "failed");
	const latestFailedAuditRequest = auditRequests.find((request) => request.status === "failed");

	if (latestFailedPayrollJob) {
		alerts.push({
			id: latestFailedPayrollJob.id,
			source: "payroll",
			severity: "error",
			title: t("settings.exportOperations.alerts.payrollFailed.title", "Payroll export failed"),
			description:
				latestFailedPayrollJob.errorMessage ??
				t(
					"settings.exportOperations.alerts.payrollFailed.description",
					"The latest payroll export did not complete.",
				),
			occurredAt: latestFailedPayrollJob.completedAt ?? latestFailedPayrollJob.createdAt,
			href: "/settings/payroll-export",
		});
	}

	for (const schedule of scheduledExports) {
		if (!schedule.isActive || schedule.reportType !== "payroll_export" || schedule.payrollConfigId) {
			continue;
		}

		alerts.push({
			id: schedule.id,
			source: "scheduled",
			severity: "warning",
			title: t(
				"settings.exportOperations.alerts.blockedSchedule.title",
				"Scheduled payroll export is blocked",
			),
			description: t(
				"settings.exportOperations.alerts.blockedSchedule.description",
				"{name} needs a payroll export configuration before it can run.",
				{ name: schedule.name },
			),
			occurredAt: schedule.lastExecutionAt ?? schedule.updatedAt ?? schedule.createdAt,
			href: "/settings/scheduled-exports",
		});
	}

	if (latestFailedAuditRequest) {
		alerts.push({
			id: latestFailedAuditRequest.id,
			source: "audit",
			severity: "error",
			title: t("settings.exportOperations.alerts.auditFailed.title", "Audit export failed"),
			description:
				latestFailedAuditRequest.errorMessage ??
				t(
					"settings.exportOperations.alerts.auditFailed.description",
					"The latest audit export request did not complete.",
				),
			occurredAt: latestFailedAuditRequest.completedAt ?? latestFailedAuditRequest.createdAt,
			href: "/settings/audit-export",
		});
	}

	return alerts;
}

function buildUpcomingRuns(
	scheduledExports: ScheduledExportRecord[],
	now: DateTime,
): ExportOperationsUpcomingRun[] {
	return scheduledExports
		.filter(
			(schedule) =>
				schedule.isActive &&
				(schedule.reportType !== "payroll_export" || Boolean(schedule.payrollConfigId)) &&
				schedule.nextExecutionAt &&
				schedule.nextExecutionAt.getTime() > now.toJSDate().getTime(),
		)
		.map((schedule) => ({
			id: schedule.id,
			source: "scheduled",
			name: schedule.name,
			scheduledFor: schedule.nextExecutionAt as Date,
			href: "/settings/scheduled-exports",
		}));
}

function buildRecentActivity(
	payrollJobs: PayrollExportJobSummary[],
	scheduledExecutions: ScheduledExecutionRecord[],
	auditRequests: AuditRequestRecord[],
	scheduledExportsById: Map<string, ScheduledExportRecord>,
	t: TranslateFn,
): ExportOperationsActivityItem[] {
	const activity: ExportOperationsActivityItem[] = [
		...payrollJobs.map((job) => ({
			id: job.id,
			source: "payroll" as const,
			status: job.status,
			title: t("settings.exportOperations.activity.payroll.title", "Payroll export"),
			description:
				job.fileName ??
				job.errorMessage ??
				t(
					"settings.exportOperations.activity.payroll.description",
					"Payroll export job recorded.",
				),
			occurredAt: job.completedAt ?? job.createdAt,
			href: "/settings/payroll-export" as const,
		})),
		...scheduledExecutions.map((execution) => ({
			id: execution.id,
			source: "scheduled" as const,
			status: execution.status,
			title:
				scheduledExportsById.get(execution.scheduledExportId)?.name ??
				t("settings.exportOperations.activity.scheduled.title", "Scheduled export"),
			description:
				execution.errorMessage ??
				t(
					"settings.exportOperations.activity.scheduled.description",
					"Scheduled export execution recorded.",
				),
			occurredAt: execution.completedAt ?? execution.triggeredAt,
			href: "/settings/scheduled-exports" as const,
		})),
		...auditRequests.map((request) => ({
			id: request.id,
			source: "audit" as const,
			status: request.status,
			title: t("settings.exportOperations.activity.audit.title", "Audit export"),
			description:
				request.errorMessage ??
				t(
					"settings.exportOperations.activity.audit.description",
					"Audit export request recorded.",
				),
			occurredAt: request.completedAt ?? request.createdAt,
			href: "/settings/audit-export" as const,
		})),
	];

	return activity.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
}

function getLastPayrollExportAt(
	payrollExports: LatestCompletedPayrollExportRecord[],
): Date | null {
	return payrollExports[0]?.completedAt ?? null;
}

function getLastAuditPackageAt(
	auditPackages: LatestCompletedAuditPackageRecord[],
): Date | null {
	return auditPackages[0]?.completedAt ?? null;
}

function countFailedRunsLast7Days(
	payrollFailures: PayrollFailureCountRecord[],
	scheduledFailures: ScheduledFailureCountRecord[],
	auditFailures: AuditFailureCountRecord[],
): number {
	const scheduledPayrollJobIds = new Set(
		scheduledFailures
			.filter((failure) => failure.underlyingJobType === "payroll_export" && failure.underlyingJobId)
			.map((failure) => failure.underlyingJobId as string),
	);

	const standalonePayrollFailures = payrollFailures.filter(
		(failure) => !scheduledPayrollJobIds.has(failure.id),
	);

	return standalonePayrollFailures.length + scheduledFailures.length + auditFailures.length;
}
