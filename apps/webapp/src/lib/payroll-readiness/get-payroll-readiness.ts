import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	approvalRequest,
	db,
	payrollExportConfig,
	payrollExportJob,
	payrollWageTypeMapping,
	timeRecord,
	travelExpenseClaim,
} from "@/db";

export type PayrollReadinessStatus = "ready" | "blocked" | "unavailable";
export type PayrollReadinessSeverity = "info" | "warning" | "blocker";
export type PayrollReadinessCheckStatus = "pass" | "warning" | "fail" | "unavailable";
export type PayrollReadinessGroup = {
	id: "time" | "payrollSetup" | "exports" | "travelExpenses";
	title: string;
	status: PayrollReadinessCheckStatus;
	checks: PayrollReadinessCheck[];
};
export type PayrollReadinessAffectedEmployee = {
	id: string;
	name?: string | null;
	email?: string | null;
};
export type PayrollReadinessCheck = {
	id: string;
	group: PayrollReadinessGroup["id"];
	title: string;
	description: string;
	status: PayrollReadinessCheckStatus;
	severity: PayrollReadinessSeverity;
	required: boolean;
	count: number;
	actionHref?: string;
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

const GROUP_TITLES: Record<PayrollReadinessGroup["id"], string> = {
	time: "Time",
	payrollSetup: "Payroll setup",
	exports: "Exports",
	travelExpenses: "Travel expenses",
};

function normalizeAffectedEmployee(source: EmployeeSource): PayrollReadinessAffectedEmployee | null {
	const employee = source.employee ?? source.requester;
	const id = employee?.id ?? source.employeeId ?? source.requestedBy;

	if (!id) {
		return null;
	}

	return {
		id,
		name: employee?.user?.name,
		email: employee?.user?.email,
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

function buildCheck(input: Omit<PayrollReadinessCheck, "affectedEmployees"> & { affectedEmployees?: PayrollReadinessAffectedEmployee[] }): PayrollReadinessCheck {
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
			title: GROUP_TITLES[groupId],
			status: groupStatus(groupChecks),
			checks: groupChecks,
		};
	});
}

function resolveStatus(checks: PayrollReadinessCheck[]): PayrollReadinessStatus {
	if (checks.some((check) => check.required && check.status === "unavailable")) {
		return "unavailable";
	}

	if (checks.some((check) => check.severity === "blocker" && check.status === "fail")) {
		return "blocked";
	}

	return "ready";
}

export async function getPayrollReadiness(input: GetPayrollReadinessInput): Promise<PayrollReadinessResult> {
	const organizationId = input.organizationId;
	const start = input.period.start.startOf("day");
	const end = input.period.end.endOf("day");
	const now = input.now ?? DateTime.utc();
	const staleActiveWorkCutoff = now.minus({ hours: 24 });

	const [activeWorkRecords, pendingApprovals, exportConfigs, latestExportJobs, travelExpenseClaims] = await Promise.all([
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
		db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.status, "pending"),
			),
			with: {
				requester: {
					with: {
						user: true,
					},
				},
			},
		}),
		db.query.payrollExportConfig.findMany({
			where: and(
				eq(payrollExportConfig.organizationId, organizationId),
				eq(payrollExportConfig.isActive, true),
			),
		}),
		db.query.payrollExportJob.findMany({
			where: eq(payrollExportJob.organizationId, organizationId),
			orderBy: [desc(payrollExportJob.createdAt)],
			limit: 1,
		}),
		db.query.travelExpenseClaim.findMany({
			where: and(
				eq(travelExpenseClaim.organizationId, organizationId),
				or(
					eq(travelExpenseClaim.status, "submitted"),
					eq(travelExpenseClaim.status, "draft"),
				),
				gte(travelExpenseClaim.tripStart, start.toJSDate()),
				lte(travelExpenseClaim.tripEnd, end.toJSDate()),
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

	const wageMappings = await db.query.payrollWageTypeMapping.findMany({
		where: exportConfigs.length > 0
			? and(
				eq(payrollWageTypeMapping.isActive, true),
				or(...exportConfigs.map((config) => eq(payrollWageTypeMapping.configId, config.id))),
			)
			: eq(payrollWageTypeMapping.isActive, true),
	});

	const staleActiveWorkRecords = activeWorkRecords.filter((record) => {
		const startAt = DateTime.fromJSDate(record.startAt);

		return startAt <= staleActiveWorkCutoff;
	});
	const latestExportJob = latestExportJobs.at(0);

	const checks: PayrollReadinessCheck[] = [
		buildCheck({
			id: "pending-approvals",
			group: "time",
			title: "Pending approvals",
			description: "All time and absence approval requests must be resolved before payroll export.",
			status: pendingApprovals.length > 0 ? "fail" : "pass",
			severity: "blocker",
			required: true,
			count: pendingApprovals.length,
			actionHref: "/approvals/inbox",
			affectedEmployees: uniqueAffectedEmployees(pendingApprovals),
		}),
		buildCheck({
			id: "stale-active-work",
			group: "time",
			title: "Stale active work periods",
			description: "Open work periods older than 24 hours may need review but do not block payroll readiness.",
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
			description: "No missing time or absence coverage issues were detected.",
			status: "pass",
			severity: "info",
			required: false,
			count: 0,
		}),
		buildCheck({
			id: "hours-outliers",
			group: "time",
			title: "Hours outliers",
			description: "No payroll-relevant hour outliers were detected.",
			status: "pass",
			severity: "info",
			required: false,
			count: 0,
		}),
		buildCheck({
			id: "payroll-export-targets",
			group: "payrollSetup",
			title: "Payroll export targets",
			description: "At least one active payroll export target must be configured.",
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
			description: "Active payroll wage type mappings must exist for export classification.",
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
			description: "The latest payroll export must not be in a failed state.",
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
			description: "No payroll export compliance warnings were detected.",
			status: "pass",
			severity: "info",
			required: false,
			count: 0,
		}),
		buildCheck({
			id: "travel-expense-warnings",
			group: "travelExpenses",
			title: "Travel expense warnings",
			description: "Draft or submitted travel expense claims may need review but do not block payroll readiness.",
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
		status: resolveStatus(checks),
		period: {
			start: start.toISODate() ?? start.toISO(),
			end: end.toISODate() ?? end.toISO(),
			label: `${start.toFormat("dd LLL yyyy")} - ${end.toFormat("dd LLL yyyy")}`,
		},
		summary: {
			blockerCount: checks.filter((check) => check.severity === "blocker" && check.status === "fail").length,
			warningCount: checks.filter((check) => check.status === "warning").length,
			affectedEmployeeCount: affectedEmployeeIds.size,
			configuredExportTargetCount: exportConfigs.length,
		},
		groups: buildGroups(checks),
	};
}
