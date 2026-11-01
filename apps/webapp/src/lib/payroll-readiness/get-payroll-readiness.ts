import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, employee, payrollExportJob, timeRecord } from "@/db";
import {
	travelExpenseClaim,
	travelExpenseLegacyDraftConversion,
	travelExpenseReport,
	travelExpenseReportItem,
} from "@/db/schema";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { findOpenDepartureClockRepairs } from "@/lib/employee-lifecycle/reviews";
import { loadPeriodSubmissionGaps } from "@/lib/time-tracking/period-submissions/submission-gaps-store";
import { loadPayrollSetupChecks } from "./payroll-setup-checks";
import { loadPersonnelIdentifierClashes } from "./personnel-identifier-clashes";

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
	/** The personnel identifier an export writes for the employee, when the check is about it. */
	personnelIdentifier?: string;
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
		latestExportJobs,
		travelExpenseClaims,
		pendingTravelExpenseReports,
		clockRepairLookup,
		periodSubmissionLookup,
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
				// A legacy draft continued as a report (#616) keeps its `draft` status
				// forever; the report it became is checked below instead.
				sql`not exists (select 1 from ${travelExpenseLegacyDraftConversion} conversion
					where conversion.organization_id = ${travelExpenseClaim.organizationId}
					and conversion.claim_id = ${travelExpenseClaim.id})`,
			),
			with: {
				employee: {
					with: {
						user: true,
					},
				},
			},
		}),
		// Submitted travel expense reports awaiting a decision: a trip overlapping
		// the period, or any expense dated inside it (logical calendar dates).
		db.query.travelExpenseReport.findMany({
			where: and(
				eq(travelExpenseReport.organizationId, organizationId),
				eq(travelExpenseReport.status, "submitted"),
				or(
					and(
						lte(travelExpenseReport.tripStartDate, selectedEndDate),
						gte(travelExpenseReport.tripEndDate, selectedStartDate),
					),
					sql`exists (select 1 from ${travelExpenseReportItem} report_item
						where report_item.organization_id = ${travelExpenseReport.organizationId}
						and report_item.report_id = ${travelExpenseReport.id}
						and report_item.expense_date between ${selectedStartDate} and ${selectedEndDate})`,
				),
			),
			columns: { id: true, employeeId: true },
		}),
		// A failed lookup must surface as unavailable, never as ready.
		findOpenDepartureClockRepairs(db, {
			organizationId,
			employeeIds: null,
			rangeStart: start.toJSDate(),
			rangeEndExclusive: end.plus({ milliseconds: 1 }).toJSDate(),
		}).then(
			(repairs) => ({ available: true as const, repairs }),
			() => ({ available: false as const, repairs: [] }),
		),
		// Missing or unapproved period submissions (#1065) for the range's logical dates; a
		// warning only, and no check at all while no submission cadence is in effect.
		loadPeriodSubmissionGaps(db, {
			organizationId,
			window: {
				from: parsePlainDate(selectedStartDate),
				to: parsePlainDate(selectedEndDate),
			},
			now: instantFromDate(now.toJSDate()),
		}).then(
			(report) => ({ available: true as const, ...report }),
			() => ({ available: false as const, collected: true, gaps: [] }),
		),
	]);

	// The setup checks the payroll setup go-live check reuses: terms over the period for
	// every active employee, clashes among the employees the period's export would carry.
	const setup = await loadPayrollSetupChecks(db, {
		organizationId,
		employees: activeEmployees,
		termsWindow: { start: start.toJSDate(), end: end.toJSDate() },
		findIdentifierClashes: (configs) =>
			loadPersonnelIdentifierClashes({
				organizationId,
				configs,
				period: { start: start.toJSDate(), end: end.toJSDate() },
				from: parsePlainDate(selectedStartDate),
				asOf: parsePlainDate(selectedEndDate),
			}),
	});

	const staleActiveWorkRecords = activeWorkRecords.filter((record) => {
		const startAt = DateTime.fromJSDate(record.startAt);

		return startAt <= staleActiveWorkCutoff;
	});
	const latestExportJob = latestExportJobs.find((job) => isExportForPeriod(job, start, end));
	// Reports load no relations; name their employees from the active employee list.
	const activeEmployeesById = new Map(
		activeEmployees.map((activeEmployee) => [activeEmployee.id, activeEmployee]),
	);
	const travelExpenseSources: EmployeeSource[] = [
		...travelExpenseClaims,
		...pendingTravelExpenseReports.map((report) => ({
			employeeId: report.employeeId,
			employee: activeEmployeesById.get(report.employeeId) ?? null,
		})),
	];
	const travelExpenseCount = travelExpenseClaims.length + pendingTravelExpenseReports.length;
	// A period still running in the range is not missing: it cannot be submitted yet.
	const periodSubmissionGaps = periodSubmissionLookup.gaps.filter((gap) => gap.status !== "running");
	const runningPeriods = periodSubmissionLookup.gaps.filter((gap) => gap.status === "running");
	const affectedBy = (gaps: typeof periodSubmissionLookup.gaps) =>
		uniqueAffectedEmployees(
			gaps.map((gap) => ({
				employeeId: gap.employeeId,
				employee: activeEmployeesById.get(gap.employeeId) ?? {
					id: gap.employeeId,
					user: { name: gap.employeeName },
				},
			})),
		);
	const periodSubmissionCheck: PayrollReadinessCheck[] = periodSubmissionLookup.collected
		? [
				buildCheck({
					id: "period-submissions",
					group: "time",
					title: "Period submissions",
					titleKey: "settings.payrollReadiness.checks.periodSubmissions.title",
					description:
						"Expected period submissions in this range that are missing, rejected, sent back after a change or still awaiting a decision. They do not block payroll export.",
					descriptionKey: "settings.payrollReadiness.checks.periodSubmissions.description",
					status: !periodSubmissionLookup.available
						? "unavailable"
						: periodSubmissionGaps.length > 0
							? "warning"
							: "pass",
					severity: periodSubmissionGaps.length > 0 ? "warning" : "info",
					required: false,
					count: periodSubmissionGaps.length,
					affectedEmployees: affectedBy(periodSubmissionGaps),
				}),
				...(runningPeriods.length > 0
					? [
							buildCheck({
								id: "period-submissions-running",
								group: "time",
								title: "Period submissions still running",
								titleKey: "settings.payrollReadiness.checks.periodSubmissionsRunning.title",
								description:
									"Periods in this range that have not ended yet, so they cannot be submitted. Their time can still change after the export.",
								descriptionKey:
									"settings.payrollReadiness.checks.periodSubmissionsRunning.description",
								status: "warning",
								severity: "info",
								required: false,
								count: runningPeriods.length,
								affectedEmployees: affectedBy(runningPeriods),
							}),
						]
					: []),
			]
		: [];

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
			id: "offboarding-clock-repairs",
			group: "time",
			title: "Offboarding clock-out repairs",
			titleKey: "settings.payrollReadiness.checks.offboardingClockRepairs.title",
			description:
				"A departed employee's running timer could not be closed safely; repair that time before payroll export.",
			descriptionKey: "settings.payrollReadiness.checks.offboardingClockRepairs.description",
			status: !clockRepairLookup.available
				? "unavailable"
				: clockRepairLookup.repairs.length > 0
					? "fail"
					: "pass",
			severity: "blocker",
			required: true,
			count: clockRepairLookup.repairs.length,
			actionHref: "/payroll",
			affectedEmployees: Array.from(
				new Set(clockRepairLookup.repairs.map((repair) => repair.employeeId)),
			).map((id) => ({ id, employeeNumber: null })),
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
		...periodSubmissionCheck,
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
		setup.employmentHistory,
		setup.exportTargets,
		setup.wageTypeMappings,
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
		setup.personnelIdentifiers,
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
				"Submitted travel expense reports and open legacy claims may need review but do not block payroll readiness.",
			descriptionKey: "settings.payrollReadiness.checks.travelExpenseWarnings.description",
			status: travelExpenseCount > 0 ? "warning" : "pass",
			severity: travelExpenseCount > 0 ? "warning" : "info",
			required: false,
			count: travelExpenseCount,
			actionHref: "/approvals/inbox?types=travel_expense_report,travel_expense_claim",
			affectedEmployees: uniqueAffectedEmployees(travelExpenseSources),
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
			configuredExportTargetCount: setup.exportTargetCount,
		},
		groups: buildGroups(checks),
	};
}
