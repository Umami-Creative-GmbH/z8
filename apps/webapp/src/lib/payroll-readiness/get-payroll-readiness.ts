import { and, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	db,
	employee,
	payrollExportConfig,
	payrollExportJob,
	payrollWageTypeMapping,
	timeRecord,
} from "@/db";
import { employeeEmploymentHistory, travelExpenseClaim } from "@/db/schema";

export type PayrollReadinessStatus = "ready" | "blocked" | "unavailable";
export type PayrollReadinessSeverity = "info" | "warning" | "blocker";
export type PayrollReadinessCheckStatus = "pass" | "warning" | "fail" | "unavailable";
export type PayrollReadinessGroup = {
	id: "time" | "payrollSetup" | "exports" | "travelExpenses";
	title: string;
	titleKey: string;
	status: PayrollReadinessCheckStatus;
	checks: PayrollReadinessCheck[];
};
export type PayrollReadinessAffectedEmployee = {
	id: string;
	name?: string | null;
	email?: string | null;
	employeeNumber: string | null;
};
export type PayrollReadinessCheck = {
	id: string;
	group: PayrollReadinessGroup["id"];
	title: string;
	titleKey: string;
	description: string;
	descriptionKey: string;
	status: PayrollReadinessCheckStatus;
	severity: PayrollReadinessSeverity;
	required: boolean;
	count: number;
	actionHref?: string;
	actionLabel?: string;
	affectedEmployees: PayrollReadinessAffectedEmployee[];
};
export type PayrollReadinessResult = {
	status: PayrollReadinessStatus;
	period: {
		start: string;
		end: string;
		label: string;
	};
	summary: {
		blockerCount: number;
		warningCount: number;
		affectedEmployeeCount: number;
		configuredExportTargetCount: number;
	};
	groups: PayrollReadinessGroup[];
};
export type GetPayrollReadinessInput = {
	organizationId: string;
	period: {
		start: DateTime;
		end: DateTime;
	};
	now?: DateTime;
};

type EmployeeLike = {
	id?: string | null;
	employeeNumber?: string | null;
	user?: {
		name?: string | null;
		email?: string | null;
	} | null;
};

type EmployeeSource = {
	employeeId?: string | null;
	requestedBy?: string | null;
	employee?: EmployeeLike | null;
	requester?: EmployeeLike | null;
};

type PayrollExportJobLike = {
	status?: string | null;
	filters?: {
		dateRange?: {
			start?: string | null;
			end?: string | null;
		} | null;
	} | null;
};

const GROUP_METADATA: Record<PayrollReadinessGroup["id"], { title: string; titleKey: string }> = {
	time: { title: "Time", titleKey: "settings.payrollReadiness.groups.time.title" },
	payrollSetup: {
		title: "Payroll setup",
		titleKey: "settings.payrollReadiness.groups.payrollSetup.title",
	},
	exports: { title: "Exports", titleKey: "settings.payrollReadiness.groups.exports.title" },
	travelExpenses: {
		title: "Travel expenses",
		titleKey: "settings.payrollReadiness.groups.travelExpenses.title",
	},
};

function normalizeAffectedEmployee(
	source: EmployeeSource,
): PayrollReadinessAffectedEmployee | null {
	const employee = source.employee ?? source.requester;
	const id = employee?.id ?? source.employeeId ?? source.requestedBy;

	if (!id) {
		return null;
	}

	return {
		id,
		name: employee?.user?.name,
		email: employee?.user?.email,
		employeeNumber: employee?.employeeNumber ?? null,
	};
}

function uniqueAffectedEmployees(sources: EmployeeSource[]): PayrollReadinessAffectedEmployee[] {
	const employees = new Map<string, PayrollReadinessAffectedEmployee>();

	for (const source of sources) {
		const employee = normalizeAffectedEmployee(source);

		if (employee && !employees.has(employee.id)) {
			employees.set(employee.id, employee);
		}
	}

	return Array.from(employees.values());
}

function isExportForPeriod(job: PayrollExportJobLike, start: DateTime, end: DateTime): boolean {
	const dateRange = job.filters?.dateRange;

	return (
		dateRange?.start?.slice(0, 10) === (start.toISODate() ?? "") &&
		dateRange?.end?.slice(0, 10) === (end.toISODate() ?? "")
	);
}

function buildCheck(
	input: Omit<PayrollReadinessCheck, "affectedEmployees"> & {
		affectedEmployees?: PayrollReadinessAffectedEmployee[];
	},
): PayrollReadinessCheck {
	return {
		...input,
		affectedEmployees: input.affectedEmployees ?? [],
	};
}

function groupStatus(checks: PayrollReadinessCheck[]): PayrollReadinessCheckStatus {
	if (checks.some((check) => check.status === "unavailable")) {
		return "unavailable";
	}

	if (checks.some((check) => check.status === "fail")) {
		return "fail";
	}

	if (checks.some((check) => check.status === "warning")) {
		return "warning";
	}

	return "pass";
}

function buildGroups(checks: PayrollReadinessCheck[]): PayrollReadinessGroup[] {
	return (["time", "payrollSetup", "exports", "travelExpenses"] as const).map((groupId) => {
		const groupChecks = checks.filter((check) => check.group === groupId);

		return {
			id: groupId,
			...GROUP_METADATA[groupId],
			status: groupStatus(groupChecks),
			checks: groupChecks,
		};
	});
}

export function derivePayrollReadinessStatus(
	checks: PayrollReadinessCheck[],
): PayrollReadinessStatus {
	if (checks.some((check) => check.required && check.status === "unavailable")) {
		return "unavailable";
	}

	if (checks.some((check) => check.severity === "blocker" && check.status === "fail")) {
		return "blocked";
	}

	return "ready";
}

export async function getPayrollReadiness(
	input: GetPayrollReadinessInput,
): Promise<PayrollReadinessResult> {
	const organizationId = input.organizationId;
	const start = input.period.start.startOf("day");
	const end = input.period.end.endOf("day");
	const selectedStartDate = start.toISODate() ?? "";
	const selectedEndDate = end.toISODate() ?? "";
	const now = input.now ?? DateTime.utc();
	const staleActiveWorkCutoff = now.minus({ hours: 24 });

	const [
		activeWorkRecords,
		pendingTimeRecords,
		activeEmployees,
		employmentHistoryRows,
		exportConfigs,
		latestExportJobs,
		travelExpenseClaims,
	] = await Promise.all([
		db.query.timeRecord.findMany({
			where: and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.recordKind, "work"),
				gte(timeRecord.startAt, start.toJSDate()),
				lte(timeRecord.startAt, end.toJSDate()),
				isNull(timeRecord.endAt),
			),
			with: {
				employee: {
					with: {
						user: true,
					},
				},
			},
		}),
		db.query.timeRecord.findMany({
			where: and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.approvalState, "pending"),
				gte(timeRecord.startAt, start.toJSDate()),
				lte(timeRecord.startAt, end.toJSDate()),
			),
			with: {
				employee: {
					with: {
						user: true,
					},
				},
			},
		}),
		db.query.employee.findMany({
			where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
			with: {
				user: true,
			},
		}),
		db.query.employeeEmploymentHistory.findMany({
			where: and(
				eq(employeeEmploymentHistory.organizationId, organizationId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lte(employeeEmploymentHistory.validFrom, end.toJSDate()),
				or(
					isNull(employeeEmploymentHistory.validUntil),
					gt(employeeEmploymentHistory.validUntil, start.toJSDate()),
				),
			),
		}),
		db.query.payrollExportConfig.findMany({
			where: and(
				eq(payrollExportConfig.organizationId, organizationId),
				eq(payrollExportConfig.isActive, true),
			),
		}),
		db.query.payrollExportJob.findMany({
			where: and(
				eq(payrollExportJob.organizationId, organizationId),
				sql`left(${payrollExportJob.filters}->'dateRange'->>'start', 10) = ${selectedStartDate}`,
				sql`left(${payrollExportJob.filters}->'dateRange'->>'end', 10) = ${selectedEndDate}`,
			),
			orderBy: [desc(payrollExportJob.createdAt)],
			limit: 1,
		}),
		db.query.travelExpenseClaim.findMany({
			where: and(
				eq(travelExpenseClaim.organizationId, organizationId),
				or(eq(travelExpenseClaim.status, "submitted"), eq(travelExpenseClaim.status, "draft")),
				lte(travelExpenseClaim.tripStart, end.toJSDate()),
				gte(travelExpenseClaim.tripEnd, start.toJSDate()),
			),
			with: {
				employee: {
					with: {
						user: true,
					},
				},
			},
		}),
	]);

	const wageMappings =
		exportConfigs.length > 0
			? await db.query.payrollWageTypeMapping.findMany({
					where: and(
						eq(payrollWageTypeMapping.isActive, true),
						or(...exportConfigs.map((config) => eq(payrollWageTypeMapping.configId, config.id))),
					),
				})
			: [];

	const staleActiveWorkRecords = activeWorkRecords.filter((record) => {
		const startAt = DateTime.fromJSDate(record.startAt);

		return startAt <= staleActiveWorkCutoff;
	});
	const employeesWithEmploymentHistory = new Set(
		employmentHistoryRows.map((row) => row.employeeId),
	);
	const missingEmploymentHistory = activeEmployees.filter(
		(activeEmployee) => !employeesWithEmploymentHistory.has(activeEmployee.id),
	);
	const latestExportJob = latestExportJobs.find((job) => isExportForPeriod(job, start, end));

	const checks: PayrollReadinessCheck[] = [
		buildCheck({
			id: "pending-approvals",
			group: "time",
			title: "Pending approvals",
			titleKey: "settings.payrollReadiness.checks.pendingApprovals.title",
			description: "All time and absence approval requests must be resolved before payroll export.",
			descriptionKey: "settings.payrollReadiness.checks.pendingApprovals.description",
			status: pendingTimeRecords.length > 0 ? "fail" : "pass",
			severity: "blocker",
			required: true,
			count: pendingTimeRecords.length,
			actionHref: "/approvals/inbox",
			affectedEmployees: uniqueAffectedEmployees(pendingTimeRecords),
		}),
		buildCheck({
			id: "stale-active-work",
			group: "time",
			title: "Stale active work periods",
			titleKey: "settings.payrollReadiness.checks.staleActiveWork.title",
			description:
				"Open work periods older than 24 hours may need review but do not block payroll readiness.",
			descriptionKey: "settings.payrollReadiness.checks.staleActiveWork.description",
			status: staleActiveWorkRecords.length > 0 ? "warning" : "pass",
			severity: staleActiveWorkRecords.length > 0 ? "warning" : "info",
			required: false,
			count: staleActiveWorkRecords.length,
			actionHref: "/time-tracking",
			affectedEmployees: uniqueAffectedEmployees(staleActiveWorkRecords),
		}),
		buildCheck({
			id: "no-time-without-absence",
			group: "time",
			title: "No time without absence",
			titleKey: "settings.payrollReadiness.checks.noTimeWithoutAbsence.title",
			description: "No missing time or absence coverage issues were detected.",
			descriptionKey: "settings.payrollReadiness.checks.noTimeWithoutAbsence.description",
			status: "pass",
			severity: "info",
			required: false,
			count: 0,
		}),
		buildCheck({
			id: "hours-outliers",
			group: "time",
			title: "Hours outliers",
			titleKey: "settings.payrollReadiness.checks.hoursOutliers.title",
			description: "No payroll-relevant hour outliers were detected.",
			descriptionKey: "settings.payrollReadiness.checks.hoursOutliers.description",
			status: "pass",
			severity: "info",
			required: false,
			count: 0,
		}),
		buildCheck({
			id: "missing-employment-history",
			group: "payrollSetup",
			title: "Employment history coverage",
			titleKey: "settings.payrollReadiness.checks.missingEmploymentHistory.title",
			description:
				missingEmploymentHistory.length > 0
					? "Some active employees do not have confirmed employment history for this payroll period."
					: "All active employees have confirmed employment history for this payroll period.",
			descriptionKey:
				missingEmploymentHistory.length > 0
					? "settings.payrollReadiness.checks.missingEmploymentHistory.descriptionWarning"
					: "settings.payrollReadiness.checks.missingEmploymentHistory.descriptionPass",
			status: missingEmploymentHistory.length > 0 ? "warning" : "pass",
			severity: "warning",
			required: false,
			count: missingEmploymentHistory.length,
			actionHref: "/settings/employees",
			actionLabel: "Review employees",
			affectedEmployees: uniqueAffectedEmployees(
				missingEmploymentHistory.map((activeEmployee) => ({ employee: activeEmployee })),
			),
		}),
		buildCheck({
			id: "payroll-export-targets",
			group: "payrollSetup",
			title: "Payroll export targets",
			titleKey: "settings.payrollReadiness.checks.payrollExportTargets.title",
			description: "At least one active payroll export target must be configured.",
			descriptionKey: "settings.payrollReadiness.checks.payrollExportTargets.description",
			status: exportConfigs.length > 0 ? "pass" : "fail",
			severity: "blocker",
			required: true,
			count: exportConfigs.length,
			actionHref: "/settings/payroll-export",
		}),
		buildCheck({
			id: "wage-type-mappings",
			group: "payrollSetup",
			title: "Wage type mappings",
			titleKey: "settings.payrollReadiness.checks.wageTypeMappings.title",
			description: "Active payroll wage type mappings must exist for export classification.",
			descriptionKey: "settings.payrollReadiness.checks.wageTypeMappings.description",
			status: wageMappings.length > 0 ? "pass" : "fail",
			severity: "blocker",
			required: true,
			count: wageMappings.length,
			actionHref: "/settings/payroll-export",
		}),
		buildCheck({
			id: "latest-payroll-export",
			group: "exports",
			title: "Latest payroll export",
			titleKey: "settings.payrollReadiness.checks.latestPayrollExport.title",
			description: "The latest payroll export must not be in a failed state.",
			descriptionKey: "settings.payrollReadiness.checks.latestPayrollExport.description",
			status: latestExportJob?.status === "failed" ? "fail" : "pass",
			severity: "blocker",
			required: true,
			count: latestExportJob ? 1 : 0,
			actionHref: "/settings/payroll-export",
		}),
		buildCheck({
			id: "compliance-warnings",
			group: "exports",
			title: "Compliance warnings",
			titleKey: "settings.payrollReadiness.checks.complianceWarnings.title",
			description: "No payroll export compliance warnings were detected.",
			descriptionKey: "settings.payrollReadiness.checks.complianceWarnings.description",
			status: "pass",
			severity: "info",
			required: false,
			count: 0,
		}),
		buildCheck({
			id: "travel-expense-warnings",
			group: "travelExpenses",
			title: "Travel expense warnings",
			titleKey: "settings.payrollReadiness.checks.travelExpenseWarnings.title",
			description:
				"Draft or submitted travel expense claims may need review but do not block payroll readiness.",
			descriptionKey: "settings.payrollReadiness.checks.travelExpenseWarnings.description",
			status: travelExpenseClaims.length > 0 ? "warning" : "pass",
			severity: travelExpenseClaims.length > 0 ? "warning" : "info",
			required: false,
			count: travelExpenseClaims.length,
			actionHref: "/travel-expenses/approvals",
			affectedEmployees: uniqueAffectedEmployees(travelExpenseClaims),
		}),
	];

	const affectedEmployeeIds = new Set(
		checks.flatMap((check) => check.affectedEmployees.map((employee) => employee.id)),
	);

	return {
		status: derivePayrollReadinessStatus(checks),
		period: {
			start: start.toISODate() ?? "",
			end: end.toISODate() ?? "",
			label: `${start.toFormat("dd LLL yyyy")} - ${end.toFormat("dd LLL yyyy")}`,
		},
		summary: {
			blockerCount: checks.filter(
				(check) => check.severity === "blocker" && check.status === "fail",
			).length,
			warningCount: checks.filter((check) => check.status === "warning").length,
			affectedEmployeeCount: affectedEmployeeIds.size,
			configuredExportTargetCount: exportConfigs.length,
		},
		groups: buildGroups(checks),
	};
}
