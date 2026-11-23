import { and, eq, exists, gte, inArray, lt, lte } from "drizzle-orm";
import type { PrincipalContext } from "@/lib/authorization";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { shiftCalendarDate, shiftDateBounds } from "@/lib/scheduling/shift-date";
import {
	buildSummaryCounts,
	detectAbsencesToday,
	detectAttendanceExceptions,
	detectCoverageRisks,
	sortActionItems,
} from "./logic";
import type {
	BriefingAbsence,
	BriefingActionItem,
	BriefingApprovalActionItem,
	BriefingApprovalBatch,
	BriefingCoverageRule,
	BriefingSection,
	BriefingShift,
	BriefingTimeRecord,
	ManagerDailyBriefing,
} from "./types";
import { approvalToBriefingItem } from "./types";

type CurrentEmployee = {
	id: string;
	role: "admin" | "manager" | "employee" | string;
	organizationId?: string | null;
};

type ScopedEmployee = {
	id: string;
	name: string;
	teamName: string | null;
};

type SourceScope = {
	organizationId: string;
	employeeIds: string[];
};

type DateSourceScope = SourceScope & {
	date: string;
};

type ShiftSourceScope = DateSourceScope & {
	/** The organization's timezone, which `shift.date` is keyed in. */
	timezone: string;
};

type TimeRecordSourceScope = SourceScope & {
	from: Date;
	to: Date;
};

export type ManagerDailyBriefingSources = {
	getScopedEmployees(input: {
		organizationId: string;
		currentEmployeeId: string;
		role: string;
	}): Promise<ScopedEmployee[]>;
	getPublishedShifts(input: ShiftSourceScope): Promise<BriefingShift[]>;
	getOpenTimeRecords(input: TimeRecordSourceScope): Promise<BriefingTimeRecord[]>;
	getApprovedAbsences(input: DateSourceScope): Promise<BriefingAbsence[]>;
	getCoverageRules(input: {
		organizationId: string;
		subareaIds?: string[];
	}): Promise<BriefingCoverageRule[]>;
	/**
	 * The viewer's pending approvals as their unified Approval inbox lists them (#1980), those
	 * requested by the scoped employees: the first page, with every match counted.
	 */
	getApprovals(
		input: SourceScope & {
			viewer: Pick<CurrentEmployee, "id" | "role">;
			/** Only `totalCount` and its failed types, no approval: the inbox counts alone. */
			countsOnly?: true;
		},
	): Promise<BriefingApprovalBatch>;
	getOvertimeWarnings(input: SourceScope): Promise<BriefingActionItem[]>;
	getPayrollIssues(input: SourceScope): Promise<BriefingActionItem[]>;
	/** The scoped employees' work periods showing driving details missing (#1127). */
	getDrivingDetailsMissingCount(input: SourceScope): Promise<number>;
};

type GetManagerDailyBriefingFromSourcesInput = {
	organizationId: string;
	currentEmployee: CurrentEmployee;
	now: Instant;
	timezone: string;
	sources: ManagerDailyBriefingSources;
	approvals?: BriefingApprovalsRead;
};

/**
 * How the briefing reads its approvals: `list`, the page `/today` shows, or `counts`, only the
 * open total and whether it is a lower bound, for a caller that shows no approval (#1980).
 */
export type BriefingApprovalsRead = "list" | "counts";

type GetManagerDailyBriefingInput = {
	currentEmployee: CurrentEmployee & { organizationId: string };
	now?: Instant;
	approvals?: BriefingApprovalsRead;
};

const WEEKDAY_NAMES: Record<number, string> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

const SECTION_LOAD_ERROR = "Section could not be loaded.";

/** The approvals the briefing shows at most; the inbox lists the rest. */
const BRIEFING_APPROVAL_LIMIT = 25;

function inboxViewerRole(role: string): "admin" | "manager" | "employee" {
	return role === "admin" || role === "manager" ? role : "employee";
}

/**
 * Whether the viewer is the session's own employee in its active organization, as the Approval
 * inbox finds it: the principal's employee, or for a platform admin (whose principal has none)
 * the session user's active employee there.
 */
async function isSessionEmployee(
	principal: PrincipalContext,
	input: { organizationId: string; viewer: { id: string } },
): Promise<boolean> {
	if (principal.activeOrganizationId !== input.organizationId) return false;
	if (principal.employee) {
		return (
			principal.employee.id === input.viewer.id &&
			principal.employee.organizationId === input.organizationId
		);
	}
	if (!principal.isPlatformAdmin) return false;
	const { db, employee } = await import("@/db");
	const { onCurrentRoster } = await import("@/lib/employee-lifecycle/current-roster");
	const own = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, input.viewer.id),
			eq(employee.userId, principal.userId),
			// The organization's current roster: active, and no departure that has come due.
			onCurrentRoster(input.organizationId, employee),
		),
		columns: { id: true },
	});
	return own !== undefined;
}

const SECTION_METADATA = {
	approvals: {
		id: "approvals",
		title: "Approvals",
		titleKey: "today.briefing.sections.approvals.title",
		description: "Pending requests waiting for a decision.",
		descriptionKey: "today.briefing.sections.approvals.description",
		emptyState: "No approvals are waiting.",
		emptyStateKey: "today.briefing.sections.approvals.empty",
	},
	attendance: {
		id: "attendance",
		title: "Attendance",
		titleKey: "today.briefing.sections.attendance.title",
		description: "Clock-in exceptions for today's published shifts.",
		descriptionKey: "today.briefing.sections.attendance.description",
		emptyState: "No attendance exceptions detected.",
		emptyStateKey: "today.briefing.sections.attendance.empty",
	},
	absences: {
		id: "absences",
		title: "Absences",
		titleKey: "today.briefing.sections.absences.title",
		description: "Approved absences overlapping today.",
		descriptionKey: "today.briefing.sections.absences.description",
		emptyState: "No approved absences today.",
		emptyStateKey: "today.briefing.sections.absences.empty",
	},
	coverage: {
		id: "coverage",
		title: "Coverage",
		titleKey: "today.briefing.sections.coverage.title",
		description: "Coverage risks for today's schedule.",
		descriptionKey: "today.briefing.sections.coverage.description",
		emptyState: "No coverage risks detected.",
		emptyStateKey: "today.briefing.sections.coverage.empty",
	},
	overtime: {
		id: "overtime",
		title: "Overtime",
		titleKey: "today.briefing.sections.overtime.title",
		description: "Employees approaching overtime thresholds.",
		descriptionKey: "today.briefing.sections.overtime.description",
		emptyState: "No overtime warnings detected.",
		emptyStateKey: "today.briefing.sections.overtime.empty",
	},
	payroll: {
		id: "payroll",
		title: "Payroll",
		titleKey: "today.briefing.sections.payroll.title",
		description: "Payroll readiness issues that may need setup.",
		descriptionKey: "today.briefing.sections.payroll.description",
		emptyState: "No payroll setup issues detected.",
		emptyStateKey: "today.briefing.sections.payroll.empty",
	},
} as const;

export async function getManagerDailyBriefingFromSources({
	organizationId,
	currentEmployee,
	now,
	timezone,
	sources,
	approvals: approvalsRead = "list",
}: GetManagerDailyBriefingFromSourcesInput): Promise<ManagerDailyBriefing> {
	const businessNow = now.toZonedDateTimeISO(timezone);
	const today = businessNow.toPlainDate();
	const date = today.toString();
	const scopedEmployees = await sources.getScopedEmployees({
		organizationId,
		currentEmployeeId: currentEmployee.id,
		role: currentEmployee.role,
	});
	const employeeIds = scopedEmployees.map((employee) => employee.id);
	const sourceScope = { organizationId, employeeIds };
	const todayRange = localDayRange(date, timezone);
	const tomorrowRange = localDayRange(today.add({ days: 1 }).toString(), timezone);
	const timeRecordWindow = {
		from: dateFromInstant(todayRange.start.subtract({ hours: 2 })),
		to: dateFromInstant(tomorrowRange.endExclusive.subtract({ milliseconds: 1 })),
	};

	const shiftsPromise = sources.getPublishedShifts({ ...sourceScope, date, timezone });
	const [shiftsResult] = await Promise.allSettled([shiftsPromise]);
	const shifts = settledValue(shiftsResult, []);
	const managerCoverageSubareaIds =
		currentEmployee.role === "manager"
			? [...new Set(shifts.flatMap((shift) => (shift.subareaId ? [shift.subareaId] : [])))]
			: undefined;
	const coverageRulesPromise =
		currentEmployee.role === "manager" && managerCoverageSubareaIds?.length === 0
			? Promise.resolve([])
			: sources.getCoverageRules({ organizationId, subareaIds: managerCoverageSubareaIds });
	const [
		timeRecordsResult,
		absencesResult,
		coverageRulesResult,
		approvalsResult,
		overtimeResult,
		payrollResult,
		drivingResult,
	] = await Promise.allSettled([
		sources.getOpenTimeRecords({ ...sourceScope, ...timeRecordWindow }),
		sources.getApprovedAbsences({ ...sourceScope, date }),
		coverageRulesPromise,
		sources.getApprovals({
			...sourceScope,
			viewer: { id: currentEmployee.id, role: currentEmployee.role },
			...(approvalsRead === "counts" ? { countsOnly: true as const } : {}),
		}),
		sources.getOvertimeWarnings(sourceScope),
		sources.getPayrollIssues(sourceScope),
		sources.getDrivingDetailsMissingCount(sourceScope),
	]);

	const timeRecords = settledValue(timeRecordsResult, []);
	const absences = settledValue(absencesResult, []);
	const managerCoverageSubareaIdSet = new Set(managerCoverageSubareaIds);
	const coverageRules = managerCoverageSubareaIds
		? settledValue(coverageRulesResult, []).filter((rule) =>
				managerCoverageSubareaIdSet.has(rule.subareaId),
			)
		: settledValue(coverageRulesResult, []);
	const scopedEmployeeIds = new Set(employeeIds);
	const approvalBatch = settledValue<BriefingApprovalBatch>(approvalsResult, []);
	const approvalItems = approvalBatch.flatMap((approval) =>
		scopedEmployeeIds.has(approval.requester.id) ? [approvalToBriefingItem(approval)] : [],
	);
	const overtimeItems = settledValue(overtimeResult, []);
	const payrollItems = settledValue(payrollResult, []);

	const attendanceItems =
		shiftsResult.status === "fulfilled" && timeRecordsResult.status === "fulfilled"
			? detectAttendanceExceptions({
					now: businessNow,
					shifts,
					records: timeRecords,
					graceMinutes: 5,
				})
			: [];
	const absenceItems =
		absencesResult.status === "fulfilled"
			? detectAbsencesToday({ today: businessNow, absences })
			: [];
	const coverageItems =
		coverageRulesResult.status === "fulfilled" && shiftsResult.status === "fulfilled"
			? detectCoverageRisks({
					dayOfWeek: WEEKDAY_NAMES[businessNow.dayOfWeek] ?? "",
					coverageRules,
					publishedShifts: shifts,
				})
			: [];

	const unavailableApprovalTypes = approvalBatch.unavailableTypes ?? [];
	const uncountedApprovalTypes = approvalBatch.uncountedTypes ?? [];
	const approvals = {
		...buildSection<BriefingApprovalActionItem>(
			"approvals",
			// Already in the inbox's own order (risk, priority, age): re-sorting would lose it.
			approvalItems,
			approvalsResult,
		),
		...(unavailableApprovalTypes.length > 0 ? { unavailableTypes: unavailableApprovalTypes } : {}),
		...(uncountedApprovalTypes.length > 0 ? { uncountedTypes: uncountedApprovalTypes } : {}),
	};
	const attendance = buildSection(
		"attendance",
		attendanceItems,
		firstRejected(shiftsResult, timeRecordsResult),
	);
	const sections = {
		approvals,
		attendance,
		absences: buildSection("absences", absenceItems, absencesResult),
		coverage: buildSection(
			"coverage",
			coverageItems,
			firstRejected(coverageRulesResult, shiftsResult),
		),
		overtime: buildSection("overtime", sortActionItems(overtimeItems), overtimeResult),
		payroll: buildSection("payroll", sortActionItems(payrollItems), payrollResult),
	};
	const sectionItems = {
		needsAction: sortActionItems([
			...sections.attendance.items,
			...sections.absences.items,
			...sections.coverage.items,
			...sections.overtime.items,
			...sections.payroll.items,
			...drivingDetailsMissingItems(settledValue(drivingResult, 0)),
		]),
		approvals: sections.approvals.items,
		attendance: sections.attendance.items,
		absences: sections.absences.items,
		coverage: sections.coverage.items,
		overtime: sections.overtime.items,
		payroll: sections.payroll.items,
	};

	return {
		generatedAt: now.toString(),
		date,
		...(drivingResult.status === "rejected"
			? { needsActionError: "Driving details could not be checked." }
			: {}),
		summary: {
			...buildSummaryCounts(sectionItems),
			// Every pending approval of the briefing's employees, not only the page it shows.
			// Never fewer than it lists: a failed count read comes back as 0.
			openApprovals: Math.max(approvalBatch.totalCount ?? 0, approvalItems.length),
			// A failed approval source leaves it a lower bound, as `/today` shows it (#1980).
			...(approvals.error ||
			unavailableApprovalTypes.length > 0 ||
			uncountedApprovalTypes.length > 0
				? { openApprovalsAtLeast: true as const }
				: {}),
			// The whole section failed: no count is known, so it is unavailable rather than "0+".
			...(approvals.error ? { openApprovalsUnavailable: true as const } : {}),
		},
		needsAction: sectionItems.needsAction,
		sections,
	};
}

export async function getManagerDailyBriefing({
	currentEmployee,
	now = systemClock.nowInstant(),
	approvals,
}: GetManagerDailyBriefingInput): Promise<ManagerDailyBriefing> {
	const [{ db, organization }, { resolveEffectiveTimezone }] = await Promise.all([
		import("@/db"),
		import("@/lib/timezone/effective-timezone"),
	]);
	const persistedOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, currentEmployee.organizationId),
		columns: { timezone: true },
	});

	return getManagerDailyBriefingFromSources({
		organizationId: currentEmployee.organizationId,
		currentEmployee,
		now,
		timezone: resolveEffectiveTimezone(undefined, persistedOrganization?.timezone),
		sources: managerDailyBriefingDatabaseSources,
		approvals,
	});
}

export const managerDailyBriefingDatabaseSources: ManagerDailyBriefingSources = {
	async getScopedEmployees({ organizationId, currentEmployeeId, role }) {
		const { db, employee, employeeManagers, team, user } = await import("@/db");

		if (role === "admin") {
			const rows = await db
				.select({
					id: employee.id,
					firstName: user.firstName,
					lastName: user.lastName,
					userName: user.name,
					teamName: team.name,
				})
				.from(employee)
				.leftJoin(user, eq(employee.userId, user.id))
				.leftJoin(team, eq(employee.teamId, team.id))
				.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)));

			return rows.map((row) => ({
				id: row.id,
				name: employeeDisplayName(row),
				teamName: row.teamName,
			}));
		}

		if (role === "manager") {
			const rows = await db
				.select({
					id: employee.id,
					firstName: user.firstName,
					lastName: user.lastName,
					userName: user.name,
					teamName: team.name,
				})
				.from(employeeManagers)
				.innerJoin(employee, eq(employeeManagers.employeeId, employee.id))
				.leftJoin(user, eq(employee.userId, user.id))
				.leftJoin(team, eq(employee.teamId, team.id))
				.where(
					and(
						eq(employeeManagers.managerId, currentEmployeeId),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
				);

			return rows.map((row) => ({
				id: row.id,
				name: employeeDisplayName(row),
				teamName: row.teamName,
			}));
		}

		const rows = await db
			.select({
				id: employee.id,
				firstName: user.firstName,
				lastName: user.lastName,
				userName: user.name,
				teamName: team.name,
			})
			.from(employee)
			.leftJoin(user, eq(employee.userId, user.id))
			.leftJoin(team, eq(employee.teamId, team.id))
			.where(
				and(
					eq(employee.id, currentEmployeeId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			);

		return rows.map((row) => ({
			id: row.id,
			name: employeeDisplayName(row),
			teamName: row.teamName,
		}));
	},

	async getPublishedShifts({ organizationId, employeeIds, date, timezone }) {
		if (employeeIds.length === 0) {
			return [];
		}

		const [dbModule, schema] = await Promise.all([import("@/db"), import("@/db/schema")]);
		const { db, employee, shift, team, user } = dbModule;
		const { locationSubarea } = schema;
		const bounds = shiftDateBounds(date, timezone);

		const rows = await db
			.select({
				id: shift.id,
				employeeId: shift.employeeId,
				firstName: user.firstName,
				lastName: user.lastName,
				userName: user.name,
				teamName: team.name,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
				status: shift.status,
				subareaId: shift.subareaId,
				subareaName: locationSubarea.name,
			})
			.from(shift)
			.innerJoin(employee, eq(shift.employeeId, employee.id))
			.leftJoin(user, eq(employee.userId, user.id))
			.leftJoin(team, eq(employee.teamId, team.id))
			.leftJoin(locationSubarea, eq(shift.subareaId, locationSubarea.id))
			.where(
				and(
					eq(shift.organizationId, organizationId),
					eq(shift.status, "published"),
					gte(shift.date, bounds.start),
					lt(shift.date, bounds.endExclusive),
					inArray(shift.employeeId, employeeIds),
				),
			);

		return rows.flatMap((row): BriefingShift[] =>
			row.employeeId
				? [
						{
							id: row.id,
							employeeId: row.employeeId,
							employeeName: employeeDisplayName(row),
							teamName: row.teamName,
							date: shiftCalendarDate(row.date, timezone).toString(),
							startTime: row.startTime,
							endTime: row.endTime,
							status: row.status,
							subareaId: row.subareaId,
							subareaName: row.subareaName,
						},
					]
				: [],
		);
	},

	async getOpenTimeRecords({ organizationId, employeeIds, from, to }) {
		if (employeeIds.length === 0) {
			return [];
		}

		const { db, workPeriod } = await import("@/db");

		const rows = await db
			.select({
				id: workPeriod.id,
				employeeId: workPeriod.employeeId,
				startAt: workPeriod.startTime,
				endAt: workPeriod.endTime,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, organizationId),
					inArray(workPeriod.employeeId, employeeIds),
					gte(workPeriod.startTime, from),
					lte(workPeriod.startTime, to),
				),
			);

		return rows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			startAt: row.startAt,
			endAt: row.endAt,
		}));
	},

	async getApprovedAbsences({ organizationId, employeeIds, date }) {
		if (employeeIds.length === 0) {
			return [];
		}

		const { absenceCategory, absenceEntry, db, employee, team, user } = await import("@/db");

		const rows = await db
			.select({
				id: absenceEntry.id,
				employeeId: absenceEntry.employeeId,
				firstName: user.firstName,
				lastName: user.lastName,
				userName: user.name,
				teamName: team.name,
				categoryName: absenceCategory.name,
				startDate: absenceEntry.startDate,
				endDate: absenceEntry.endDate,
				status: absenceEntry.status,
			})
			.from(absenceEntry)
			.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
			.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
			.leftJoin(user, eq(employee.userId, user.id))
			.leftJoin(team, eq(employee.teamId, team.id))
			.where(
				and(
					eq(absenceEntry.organizationId, organizationId),
					inArray(absenceEntry.employeeId, employeeIds),
					eq(absenceEntry.status, "approved"),
					lte(absenceEntry.startDate, date),
					gte(absenceEntry.endDate, date),
				),
			);

		return rows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			employeeName: employeeDisplayName(row),
			teamName: row.teamName,
			categoryName: row.categoryName,
			startDate: row.startDate,
			endDate: row.endDate,
			status: row.status,
		}));
	},

	async getCoverageRules({ organizationId, subareaIds }) {
		const [{ db }, { coverageRule, locationSubarea }] = await Promise.all([
			import("@/db"),
			import("@/db/schema"),
		]);
		const conditions = [eq(coverageRule.organizationId, organizationId)];

		if (subareaIds) {
			if (subareaIds.length === 0) {
				return [];
			}

			conditions.push(inArray(coverageRule.subareaId, subareaIds));
		}

		const rows = await db
			.select({
				id: coverageRule.id,
				subareaId: coverageRule.subareaId,
				subareaName: locationSubarea.name,
				dayOfWeek: coverageRule.dayOfWeek,
				startTime: coverageRule.startTime,
				endTime: coverageRule.endTime,
				minimumStaffCount: coverageRule.minimumStaffCount,
			})
			.from(coverageRule)
			.innerJoin(locationSubarea, eq(coverageRule.subareaId, locationSubarea.id))
			.where(and(...conditions));

		return rows;
	},

	async getApprovals({ organizationId, employeeIds, viewer, countsOnly }) {
		if (employeeIds.length === 0) {
			return [];
		}

		await import("@/lib/approvals/init");
		const [
			{ getPrincipalContext },
			{ defineAbilityFor },
			{ resolveApprovalInboxViewerScope },
			{ getApprovalInboxTotals },
			{ getApprovalInboxTopItems },
		] = await Promise.all([
			import("@/lib/auth-helpers"),
			import("@/lib/authorization"),
			import("@/lib/approvals/inbox/viewer-scope"),
			import("@/lib/approvals/inbox/read-service"),
			import("@/lib/approvals/inbox/top-items"),
		]);
		// The session's own inbox, as `/approvals/inbox` opens it: its active organization and its
		// own employee there, or no approvals at all.
		const principal = await getPrincipalContext();
		if (!principal || !(await isSessionEmployee(principal, { organizationId, viewer }))) {
			return [];
		}
		// The viewer's inbox exactly as `/approvals/inbox` shows it (#1977), or none at all.
		const scope = await resolveApprovalInboxViewerScope({
			ability: defineAbilityFor(principal),
			employee: { id: viewer.id, organizationId, role: inboxViewerRole(viewer.role) },
			// The briefing shows no "Covering for" sections, so it reads no deputy covers.
			includeCovering: false,
		});
		if (!scope) {
			return [];
		}

		// The inbox's own list, ordered by risk, priority and age, read for the briefing's employees
		// alone, so others' requests never crowd theirs off the page. Its "Covering for" sections are
		// not the briefing's, so they are not read. A caller showing only the total gets the same
		// counts without a row or its triage evidence (#1980). The list reads current evidence only
		// for the items that can still reach the page, a few at a time, as the Dashboard does: the
		// briefing renders on every visit and after every decision.
		const params = {
			...scope,
			covering: undefined,
			requesterEmployeeIds: employeeIds,
			status: "pending" as const,
		};
		const result = countsOnly
			? { items: [], ...(await getApprovalInboxTotals(params)) }
			: await getApprovalInboxTopItems(params, { limit: BRIEFING_APPROVAL_LIMIT });
		// Name each failed source, as the inbox tells its warnings apart (#1978), so the briefing
		// never shows a total or a list that silently lacks its items. A failed count still lists
		// its rows but leaves them out of the total; any other failure (or one of unknown kind)
		// lacks rows. A "Covering for" header count is no total of the briefing's.
		const unavailable = new Set<string>();
		const uncounted = new Set<string>();
		for (const warning of result.warnings) {
			if (warning.failure === "covering_count") continue;
			(warning.failure === "count" ? uncounted : unavailable).add(warning.source);
		}
		const unavailableTypes = [...unavailable];
		const uncountedTypes = [...uncounted].filter((type) => !unavailable.has(type));
		// A type whose count failed still read its rows: count at least those, as the Dashboard
		// does (#1978), so a cut-off list never reads as complete.
		const listed: Partial<Record<string, number>> = "listed" in result ? result.listed : {};
		const counts: Partial<Record<string, number>> = result.counts;
		const unseen = uncountedTypes.reduce(
			(sum, type) => sum + Math.max(0, (listed[type] ?? 0) - (counts[type] ?? 0)),
			0,
		);
		return Object.assign(result.items, {
			totalCount: result.total + unseen,
			...(unavailableTypes.length > 0 ? { unavailableTypes } : {}),
			...(uncountedTypes.length > 0 ? { uncountedTypes } : {}),
		});
	},

	async getOvertimeWarnings() {
		return [];
	},

	async getDrivingDetailsMissingCount({ organizationId, employeeIds }) {
		if (employeeIds.length === 0) {
			return 0;
		}

		const [{ db }, { countDrivingDetailsMissing }] = await Promise.all([
			import("@/db"),
			import("@/lib/time-tracking/vehicle-use/driving-details-missing-store"),
		]);

		// Counted in SQL over the active employees `/team/driving` lists.
		return countDrivingDetailsMissing(db, { organizationId, employeeIds });
	},

	async getPayrollIssues({ organizationId }) {
		const { db, payrollExportConfig, payrollWageTypeMapping } = await import("@/db");

		const rows = await db
			.select({ id: payrollWageTypeMapping.id })
			.from(payrollWageTypeMapping)
			.where(
				and(
					eq(payrollWageTypeMapping.organizationId, organizationId),
					eq(payrollWageTypeMapping.isActive, true),
					exists(
						db
							.select({ id: payrollExportConfig.id })
							.from(payrollExportConfig)
							.where(
								and(
									eq(payrollExportConfig.organizationId, organizationId),
									eq(payrollExportConfig.isActive, true),
								),
							),
					),
				),
			)
			.limit(1);

		if (rows.length > 0) {
			return [];
		}

		return [
			{
				id: "payroll:wage-mappings",
				category: "payroll",
				severity: "warning",
				title: "Payroll wage mappings are missing",
				titleKey: "today.briefing.items.payrollWageMappings.title",
				description:
					"No active wage type mappings are configured for the active payroll export setup.",
				descriptionKey: "today.briefing.items.payrollWageMappings.description",
				href: "/payroll",
			},
		];
	},
};

/**
 * One item counting the scoped employees' work lacking its vehicle or an odometer reading (#1127),
 * linking to the team list where it can be filtered; none without any.
 */
function drivingDetailsMissingItems(count: number): BriefingActionItem[] {
	if (count <= 0) return [];
	return [
		{
			id: "driving:details-missing",
			category: "driving",
			severity: "warning",
			title: DRIVING_DETAILS_MISSING_TEXT.title.replace("{count}", String(count)),
			titleKey: DRIVING_DETAILS_MISSING_TEXT.titleKey,
			titleParams: { count },
			description: DRIVING_DETAILS_MISSING_TEXT.description,
			descriptionKey: DRIVING_DETAILS_MISSING_TEXT.descriptionKey,
			href: "/team/driving",
		},
	];
}

// Each key sits next to its English template, so the Tolgee extractor reads it as the default.
const DRIVING_DETAILS_MISSING_TEXT = {
	titleKey: "today.briefing.items.drivingDetailsMissing.title",
	title: "Driving details missing ({count})",
	descriptionKey: "today.briefing.items.drivingDetailsMissing.description",
	description: "Work periods of your employees lacking a vehicle or an odometer reading.",
} as const;

function buildSection<TItem extends BriefingActionItem>(
	sectionId: keyof typeof SECTION_METADATA,
	items: TItem[],
	result?: PromiseSettledResult<unknown>,
): BriefingSection<TItem> {
	const metadata = SECTION_METADATA[sectionId];

	return {
		...metadata,
		items,
		...(result?.status === "rejected" ? { error: errorMessage(result.reason) } : {}),
	};
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
	return result.status === "fulfilled" ? result.value : fallback;
}

function firstRejected(
	...results: PromiseSettledResult<unknown>[]
): PromiseSettledResult<unknown> | undefined {
	return results.find((result) => result.status === "rejected");
}

function errorMessage(_reason: unknown): string {
	return SECTION_LOAD_ERROR;
}

function employeeDisplayName(row: {
	firstName: string | null;
	lastName: string | null;
	userName: string | null;
	id: string;
}): string {
	return [row.firstName, row.lastName].filter(Boolean).join(" ") || row.userName || row.id;
}
