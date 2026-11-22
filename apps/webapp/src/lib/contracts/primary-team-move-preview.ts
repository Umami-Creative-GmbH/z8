import { and, asc, eq, inArray, or } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import {
	contractDefault,
	contractTemplateVersion,
	contractTemplateVersionDay,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentHistoryDay,
	employeeEmploymentPeriod,
	employeeTeamHistory,
	team,
	userSettings,
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyPresence,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyVersion,
} from "@/db/schema";
import type { ArbzgScope, EmploymentProfile } from "@/db/schema/contract-types";
import {
	instantFromDate,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { ContractType } from "@/lib/validations/employee";
import { parseIsoCalendarDate } from "./contract-validation";
import { normalizeHoursToMinutes } from "./custom-days";
import {
	attachPrecomputedScheduleAnchors,
	type ContractDefaultSnapshot,
	type EmploymentHistorySnapshot,
	type EmploymentPeriodSnapshot,
	resolveEffectiveContractPure,
	type TeamHistoryInterval,
	type WorkPolicySnapshot,
	type WorkPolicyVersionSnapshot,
} from "./resolve-contract";
import type {
	ContractFieldSource,
	CustomWorkDay,
	DayOfWeek,
	EffectiveContractOnDay,
	ResolvedOnCallTerms,
	ResolvedWorkPolicyPresence,
	ResolvedWorkPolicyRegulation,
	ResolvedWorkPolicySchedule,
	WeeklyHoursMismatchWarning,
} from "./types";

export interface PrimaryTeamMoveScheduleDaySummary {
	readonly dayOfWeek: DayOfWeek;
	readonly minutesPerDay: number;
	readonly latestClockIn: string | null;
}

export interface PrimaryTeamMoveOperationalChange {
	readonly field:
		| "workPolicy"
		| "weeklyContractMinutes"
		| "scheduleMode"
		| "weeklyScheduleDays"
		| "workModel"
		| "presenceOverride"
		| "presenceStatus"
		| "balanceMode"
		| "scheduleSource";
	readonly before: string | number | null;
	readonly after: string | number | null;
	readonly beforeLabel: string | null;
	readonly afterLabel: string | null;
	readonly beforeScheduleDays?: readonly PrimaryTeamMoveScheduleDaySummary[] | null;
	readonly afterScheduleDays?: readonly PrimaryTeamMoveScheduleDaySummary[] | null;
	readonly beforeSource: ContractFieldSource;
	readonly afterSource: ContractFieldSource;
}

export interface PreviewPrimaryTeamMoveResult {
	readonly employeeId: string;
	readonly effectiveOnDate: string;
	readonly currentPrimaryTeamId: string | null;
	readonly currentPrimaryTeamName: string | null;
	readonly targetPrimaryTeamId: string | null;
	readonly targetPrimaryTeamName: string | null;
	readonly hasOperationalChanges: boolean;
	readonly changes: readonly PrimaryTeamMoveOperationalChange[];
	readonly preservedPersonalDivergences: readonly string[];
	readonly preservedEmployeeOwnedTerms: {
		readonly contractType: ContractType;
		readonly employmentProfile: EmploymentProfile;
		readonly arbzgScope: ArbzgScope;
		readonly onCallTerms: ResolvedOnCallTerms | null;
	};
	readonly mismatchWarning: WeeklyHoursMismatchWarning | null;
	readonly currentContract: EffectiveContractOnDay;
	readonly projectedContract: EffectiveContractOnDay;
}

function parseFixedDaysJson(raw: string | null): readonly DayOfWeek[] | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as DayOfWeek[]) : null;
	} catch {
		return null;
	}
}

/**
 * Strictly read-only operational rule preview for moving an employee to a new primary team
 * (or clearing their primary team). Compares the effective contract under their current
 * primary team vs. `targetTeamId`, preserving personal divergences and never mutating
 * employee-owned legal, pay, or personal divergence terms.
 */
export async function previewPrimaryTeamMove(
	db: Pick<DatabaseClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		targetTeamId: string | null;
		effectiveOnDate?: string;
	},
): Promise<PreviewPrimaryTeamMoveResult> {
	const [[orgRow], [empRow]] = await Promise.all([
		db
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.limit(1),
		db
			.select({
				id: employee.id,
				teamId: employee.teamId,
				contractType: employee.contractType,
				userTimezone: userSettings.timezone,
			})
			.from(employee)
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.where(
				and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
			)
			.limit(1),
	]);

	if (!empRow) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}

	if (input.targetTeamId) {
		const [targetTeam] = await db
			.select({ id: team.id })
			.from(team)
			.where(and(eq(team.id, input.targetTeamId), eq(team.organizationId, input.organizationId)))
			.limit(1);
		if (!targetTeam) {
			throw new NotFoundError({
				message: "Target team not found",
				entityType: "team",
				entityId: input.targetTeamId,
			});
		}
	}

	const orgTimezone = orgRow?.timezone ?? "UTC";
	const employeeCalendarTimezone = resolveEffectiveTimezone(empRow.userTimezone, orgTimezone);
	const effectiveOnDate = input.effectiveOnDate
		? parseIsoCalendarDate(input.effectiveOnDate, "effectiveOnDate")
		: plainDateAt(systemClock.nowInstant(), employeeCalendarTimezone).toString();
	const day = parsePlainDate(effectiveOnDate);

	const [periodRows, teamHistoryRows, termsRows, defaultRows, assignmentRows] = await Promise.all([
		db
			.select({
				id: employeeEmploymentPeriod.id,
				employeeId: employeeEmploymentPeriod.employeeId,
				status: employeeEmploymentPeriod.status,
				startedAt: employeeEmploymentPeriod.startedAt,
				startProvenance: employeeEmploymentPeriod.startProvenance,
				endedAt: employeeEmploymentPeriod.endedAt,
				createdAt: employeeEmploymentPeriod.createdAt,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, input.organizationId),
					eq(employeeEmploymentPeriod.employeeId, input.employeeId),
				),
			),
		db
			.select({
				id: employeeTeamHistory.id,
				employeeId: employeeTeamHistory.employeeId,
				teamId: employeeTeamHistory.teamId,
				effectiveFrom: employeeTeamHistory.effectiveFrom,
				effectiveTo: employeeTeamHistory.effectiveTo,
			})
			.from(employeeTeamHistory)
			.where(
				and(
					eq(employeeTeamHistory.organizationId, input.organizationId),
					eq(employeeTeamHistory.employeeId, input.employeeId),
				),
			),
		db
			.select()
			.from(employeeEmploymentHistory)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					eq(employeeEmploymentHistory.employeeId, input.employeeId),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
				),
			)
			.orderBy(asc(employeeEmploymentHistory.validFrom), asc(employeeEmploymentHistory.createdAt)),
		db
			.select({
				id: contractDefault.id,
				scope: contractDefault.scope,
				teamId: contractDefault.teamId,
				templateVersionId: contractDefault.templateVersionId,
				effectiveFromDate: contractDefault.effectiveFromDate,
				effectiveUntilDate: contractDefault.effectiveUntilDate,
				createdAt: contractDefault.createdAt,
				workPolicyId: contractTemplateVersion.workPolicyId,
				weeklyContractMinutes: contractTemplateVersion.weeklyContractMinutes,
				scheduleMode: contractTemplateVersion.scheduleMode,
				workModel: contractTemplateVersion.workModel,
				presenceOverride: contractTemplateVersion.presenceOverride,
				balanceMode: contractTemplateVersion.balanceMode,
				scheduleSource: contractTemplateVersion.scheduleSource,
			})
			.from(contractDefault)
			.innerJoin(
				contractTemplateVersion,
				and(
					eq(contractTemplateVersion.id, contractDefault.templateVersionId),
					eq(contractTemplateVersion.organizationId, contractDefault.organizationId),
				),
			)
			.where(
				and(
					eq(contractDefault.organizationId, input.organizationId),
					eq(contractDefault.isActive, true),
				),
			),
		db
			.select({
				id: workPolicyAssignment.id,
				policyId: workPolicyAssignment.policyId,
				assignmentType: workPolicyAssignment.assignmentType,
				teamId: workPolicyAssignment.teamId,
				employeeId: workPolicyAssignment.employeeId,
				priority: workPolicyAssignment.priority,
				sourceKind: workPolicyAssignment.sourceKind,
				sourceEmploymentHistoryId: workPolicyAssignment.sourceEmploymentHistoryId,
				isActive: workPolicyAssignment.isActive,
				effectiveFrom: workPolicyAssignment.effectiveFrom,
				effectiveUntil: workPolicyAssignment.effectiveUntil,
				effectiveFromDate: workPolicyAssignment.effectiveFromDate,
				effectiveUntilDate: workPolicyAssignment.effectiveUntilDate,
				createdAt: workPolicyAssignment.createdAt,
			})
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, input.organizationId),
					or(
						and(
							eq(workPolicyAssignment.isActive, true),
							or(
								eq(workPolicyAssignment.assignmentType, "organization"),
								eq(workPolicyAssignment.assignmentType, "team"),
								and(
									eq(workPolicyAssignment.assignmentType, "employee"),
									eq(workPolicyAssignment.employeeId, input.employeeId),
								),
							),
						),
						and(
							eq(workPolicyAssignment.assignmentType, "employee"),
							eq(workPolicyAssignment.sourceKind, "employment_terms"),
							eq(workPolicyAssignment.employeeId, input.employeeId),
						),
					),
				),
			),
	]);

	const historyIds = termsRows.map((r) => r.id);
	const templateVersionIds = [...new Set(defaultRows.map((r) => r.templateVersionId))];
	const referencedTeamIds = [
		...new Set([
			...teamHistoryRows.map((r) => r.teamId),
			...(empRow.teamId ? [empRow.teamId] : []),
			...(input.targetTeamId ? [input.targetTeamId] : []),
			...defaultRows.flatMap((r) => (r.teamId ? [r.teamId] : [])),
		]),
	];
	const referencedPolicyIds = [
		...new Set([
			...termsRows.flatMap((r) => (r.workPolicyId ? [r.workPolicyId] : [])),
			...defaultRows.flatMap((r) => (r.workPolicyId ? [r.workPolicyId] : [])),
			...assignmentRows.map((r) => r.policyId),
		]),
	];

	const [historyDayRows, templateDayRows, referencedTeams, policyRows, versionRows] =
		await Promise.all([
			historyIds.length > 0
				? db
						.select()
						.from(employeeEmploymentHistoryDay)
						.where(
							and(
								eq(employeeEmploymentHistoryDay.organizationId, input.organizationId),
								inArray(employeeEmploymentHistoryDay.employmentHistoryId, historyIds),
							),
						)
				: Promise.resolve([]),
			templateVersionIds.length > 0
				? db
						.select()
						.from(contractTemplateVersionDay)
						.where(
							and(
								eq(contractTemplateVersionDay.organizationId, input.organizationId),
								inArray(contractTemplateVersionDay.templateVersionId, templateVersionIds),
							),
						)
				: Promise.resolve([]),
			referencedTeamIds.length > 0
				? db
						.select({ id: team.id, organizationId: team.organizationId, name: team.name })
						.from(team)
						.where(inArray(team.id, referencedTeamIds))
				: Promise.resolve([]),
			referencedPolicyIds.length > 0
				? db
						.select()
						.from(workPolicy)
						.where(
							and(
								eq(workPolicy.organizationId, input.organizationId),
								inArray(workPolicy.id, referencedPolicyIds),
							),
						)
				: Promise.resolve([]),
			referencedPolicyIds.length > 0
				? db
						.select()
						.from(workPolicyVersion)
						.where(
							and(
								eq(workPolicyVersion.organizationId, input.organizationId),
								inArray(workPolicyVersion.policyId, referencedPolicyIds),
							),
						)
				: Promise.resolve([]),
		]);

	const versionIds = versionRows.map((v) => v.id);
	const [scheduleRows, regulationRows, presenceRows] = await Promise.all([
		versionIds.length > 0
			? db
					.select()
					.from(workPolicySchedule)
					.where(inArray(workPolicySchedule.policyVersionId, versionIds))
			: Promise.resolve([]),
		versionIds.length > 0
			? db
					.select()
					.from(workPolicyRegulation)
					.where(inArray(workPolicyRegulation.policyVersionId, versionIds))
			: Promise.resolve([]),
		versionIds.length > 0
			? db
					.select()
					.from(workPolicyPresence)
					.where(inArray(workPolicyPresence.policyVersionId, versionIds))
			: Promise.resolve([]),
	]);

	const scheduleIds = scheduleRows.map((s) => s.id);
	const regulationIds = regulationRows.map((r) => r.id);
	const [scheduleDayRows, breakRuleRows] = await Promise.all([
		scheduleIds.length > 0
			? db
					.select()
					.from(workPolicyScheduleDay)
					.where(inArray(workPolicyScheduleDay.scheduleId, scheduleIds))
			: Promise.resolve([]),
		regulationIds.length > 0
			? db
					.select()
					.from(workPolicyBreakRule)
					.where(inArray(workPolicyBreakRule.regulationId, regulationIds))
			: Promise.resolve([]),
	]);

	const breakRuleIds = breakRuleRows.map((r) => r.id);
	const breakOptionRows =
		breakRuleIds.length > 0
			? await db
					.select()
					.from(workPolicyBreakOption)
					.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds))
			: [];

	const validOrgTeamIds = new Set<string>();
	const foreignTeamIds = new Set<string>();
	const teamNames = new Map<string, string>();
	for (const t of referencedTeams) {
		if (t.organizationId === input.organizationId) {
			validOrgTeamIds.add(t.id);
			teamNames.set(t.id, t.name);
		} else {
			foreignTeamIds.add(t.id);
		}
	}

	const historyDaysByHistoryId = Map.groupBy(historyDayRows, (d) => d.employmentHistoryId);
	const templateDaysByVersionId = Map.groupBy(templateDayRows, (d) => d.templateVersionId);
	const scheduleDaysByScheduleId = Map.groupBy(scheduleDayRows, (d) => d.scheduleId);
	const breakOptionsByRuleId = Map.groupBy(breakOptionRows, (o) => o.breakRuleId);
	const breakRulesByRegulationId = Map.groupBy(breakRuleRows, (r) => r.regulationId);

	const scheduleByVersionId = new Map<string, ResolvedWorkPolicySchedule>();
	for (const row of scheduleRows) {
		scheduleByVersionId.set(row.policyVersionId, {
			id: row.id,
			scheduleCycle: row.scheduleCycle,
			scheduleType: row.scheduleType,
			workingDaysPreset: row.workingDaysPreset,
			hoursPerCycle: row.hoursPerCycle,
			normalizedCycleMinutes: normalizeHoursToMinutes(row.hoursPerCycle),
			homeOfficeDaysPerCycle: row.homeOfficeDaysPerCycle ?? 0,
			days: (scheduleDaysByScheduleId.get(row.id) ?? []).map((d) => ({
				dayOfWeek: d.dayOfWeek,
				hoursPerDay: d.hoursPerDay,
				minutesPerDay: normalizeHoursToMinutes(d.hoursPerDay) ?? 0,
				isWorkDay: d.isWorkDay,
				cycleWeek: d.cycleWeek ?? 1,
				latestClockIn: d.latestClockIn ?? null,
			})),
		});
	}

	const regulationByVersionId = new Map<string, ResolvedWorkPolicyRegulation>();
	for (const row of regulationRows) {
		regulationByVersionId.set(row.policyVersionId, {
			id: row.id,
			maxDailyMinutes: row.maxDailyMinutes,
			maxWeeklyMinutes: row.maxWeeklyMinutes,
			maxUninterruptedMinutes: row.maxUninterruptedMinutes,
			minRestPeriodMinutes: row.minRestPeriodMinutes,
			restPeriodEnforcement: row.restPeriodEnforcement ?? "warn",
			overtimeDailyThresholdMinutes: row.overtimeDailyThresholdMinutes,
			overtimeWeeklyThresholdMinutes: row.overtimeWeeklyThresholdMinutes,
			overtimeMonthlyThresholdMinutes: row.overtimeMonthlyThresholdMinutes,
			alertBeforeLimitMinutes: row.alertBeforeLimitMinutes ?? 30,
			alertThresholdPercent: row.alertThresholdPercent ?? 80,
			breakRules: (breakRulesByRegulationId.get(row.id) ?? [])
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((rule) => ({
					id: rule.id,
					workingMinutesThreshold: rule.workingMinutesThreshold,
					requiredBreakMinutes: rule.requiredBreakMinutes,
					options: (breakOptionsByRuleId.get(rule.id) ?? [])
						.sort((a, b) => a.sortOrder - b.sortOrder)
						.map((opt) => ({
							splitCount: opt.splitCount,
							minimumSplitMinutes: opt.minimumSplitMinutes,
							minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
						})),
				})),
		});
	}

	const presenceByVersionId = new Map<string, ResolvedWorkPolicyPresence>();
	for (const row of presenceRows) {
		presenceByVersionId.set(row.policyVersionId, {
			id: row.id,
			presenceMode: row.presenceMode,
			requiredOnsiteDays: row.requiredOnsiteDays,
			requiredOnsiteFixedDays: parseFixedDaysJson(row.requiredOnsiteFixedDays),
			locationId: row.locationId,
			evaluationPeriod: row.evaluationPeriod,
			enforcement: row.enforcement,
		});
	}

	const versionsByPolicyId = new Map<string, WorkPolicyVersionSnapshot[]>();
	for (const v of versionRows) {
		const list = versionsByPolicyId.get(v.policyId) ?? [];
		list.push({
			id: v.id,
			policyId: v.policyId,
			versionNumber: v.versionNumber,
			effectiveFromDate: v.effectiveFromDate,
			scheduleEnabled: v.scheduleEnabled,
			regulationEnabled: v.regulationEnabled,
			presenceEnabled: v.presenceEnabled,
			schedule: scheduleByVersionId.get(v.id) ?? null,
			regulation: regulationByVersionId.get(v.id) ?? null,
			presence: presenceByVersionId.get(v.id) ?? null,
		});
		versionsByPolicyId.set(v.policyId, list);
	}

	const policiesById = new Map<string, WorkPolicySnapshot>();
	for (const p of policyRows) {
		policiesById.set(p.id, {
			id: p.id,
			name: p.name,
			isActive: p.isActive,
			retiredOnDate:
				!p.isActive && p.updatedAt
					? plainDateAt(instantFromDate(p.updatedAt), orgTimezone).toString()
					: null,
			scheduleEnabled: p.scheduleEnabled,
			regulationEnabled: p.regulationEnabled,
			presenceEnabled: p.presenceEnabled,
			versions: attachPrecomputedScheduleAnchors(versionsByPolicyId.get(p.id) ?? []),
		});
	}

	const periods: EmploymentPeriodSnapshot[] = periodRows.map((p) => ({
		id: p.id,
		employeeId: p.employeeId,
		status: p.status,
		startedAt: p.startedAt ? instantFromDate(p.startedAt) : null,
		startProvenance: p.startProvenance,
		endedAt: p.endedAt ? instantFromDate(p.endedAt) : null,
		createdAt: instantFromDate(p.createdAt),
	}));

	const currentTeamHistory: TeamHistoryInterval[] = teamHistoryRows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		teamId: row.teamId,
		effectiveFrom: instantFromDate(row.effectiveFrom),
		effectiveTo: row.effectiveTo ? instantFromDate(row.effectiveTo) : null,
	}));

	const dayStartInstant = day.toZonedDateTime(employeeCalendarTimezone).toInstant();
	// Current team: prefer captured team history, falling back to synthetic interval for current `empRow.teamId`
	// when the move preview is computed on a date at/after the current team placement.
	const currentBaselineHistory: TeamHistoryInterval[] =
		currentTeamHistory.length > 0
			? currentTeamHistory
			: empRow.teamId
				? [
						{
							id: "preview-current-team",
							employeeId: input.employeeId,
							teamId: empRow.teamId,
							effectiveFrom: dayStartInstant,
							effectiveTo: null,
						},
					]
				: [];

	const targetTeamHistory: TeamHistoryInterval[] = input.targetTeamId
		? [
				{
					id: "preview-target-team",
					employeeId: input.employeeId,
					teamId: input.targetTeamId,
					effectiveFrom: dayStartInstant,
					effectiveTo: null,
				},
			]
		: [];

	const confirmedTerms: EmploymentHistorySnapshot[] = termsRows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		employmentPeriodId: row.employmentPeriodId,
		validFrom: row.validFrom,
		validUntil: row.validUntil,
		validFromDate: row.validFromDate,
		validUntilDate: row.validUntilDate,
		contractType: row.contractType,
		weeklyContractMinutes: row.weeklyContractMinutes,
		workModel: row.workModel,
		workPolicyId: row.workPolicyId,
		scheduleMode: row.scheduleMode,
		presenceOverride: row.presenceOverride,
		balanceMode: row.balanceMode,
		scheduleSource: row.scheduleSource,
		employmentProfile: row.employmentProfile,
		arbzgScope: row.arbzgScope,
		onCallHoursKind: row.onCallHoursKind,
		onCallWeeklyMinutes: row.onCallWeeklyMinutes,
		onCallDailyMinutes: row.onCallDailyMinutes,
		migratedLegacyTerms: row.migratedLegacyTerms,
		hourlyRate: row.hourlyRate,
		currency: row.currency,
		createdAt: row.createdAt,
		customDays: (historyDaysByHistoryId.get(row.id) ?? []).map((d): CustomWorkDay => ({
			dayOfWeek: d.dayOfWeek,
			minutesPerDay: d.minutesPerDay,
			isWorkDay: d.isWorkDay,
			latestClockIn: d.latestClockIn,
		})),
	}));

	const contractDefaults: ContractDefaultSnapshot[] = defaultRows.map((row) => ({
		...row,
		customDays: (templateDaysByVersionId.get(row.templateVersionId) ?? []).map(
			(d): CustomWorkDay => ({
				dayOfWeek: d.dayOfWeek,
				minutesPerDay: d.minutesPerDay,
				isWorkDay: d.isWorkDay,
				latestClockIn: d.latestClockIn,
			}),
		),
	}));

	const sharedInput = {
		date: day,
		employeeId: input.employeeId,
		employeeContractType: empRow.contractType,
		employeeCalendarTimezone,
		organizationTimezone: orgTimezone,
		employmentPeriods: periods,
		validOrgTeamIds,
		foreignTeamIds,
		teamNames,
		confirmedTerms,
		contractDefaults,
		policyAssignments: assignmentRows,
		policiesById,
	};

	const currentContract = resolveEffectiveContractPure({
		...sharedInput,
		teamHistory: currentBaselineHistory,
	});
	const projectedContract = resolveEffectiveContractPure({
		...sharedInput,
		teamHistory: targetTeamHistory,
	});

	const CANONICAL_DAY_ORDER: readonly DayOfWeek[] = [
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
		"sunday",
	];
	const serializeGrid = (
		days: readonly {
			readonly dayOfWeek: DayOfWeek;
			readonly isWorkDay: boolean;
			readonly minutesPerDay: number;
			readonly latestClockIn: string | null;
		}[],
	) => {
		if (days.length === 0) return "";
		const byDay = new Map(days.map((d) => [d.dayOfWeek, d]));
		return CANONICAL_DAY_ORDER.map((day) => {
			const row = byDay.get(day);
			if (!row) return `${day}:0:0:`;
			return `${day}:${row.isWorkDay ? 1 : 0}:${row.minutesPerDay}:${row.latestClockIn ?? ""}`;
		}).join("|");
	};
	const DAY_SHORT: Record<string, string> = {
		monday: "Mon",
		tuesday: "Tue",
		wednesday: "Wed",
		thursday: "Thu",
		friday: "Fri",
		saturday: "Sat",
		sunday: "Sun",
	};
	const formatScheduleDaysLabel = (
		days: readonly {
			dayOfWeek: string;
			isWorkDay: boolean;
			minutesPerDay: number;
			latestClockIn: string | null;
		}[],
	): string | null => {
		const byDay = new Map(days.map((d) => [d.dayOfWeek, d]));
		const parts: string[] = [];
		for (const day of [
			"monday",
			"tuesday",
			"wednesday",
			"thursday",
			"friday",
			"saturday",
			"sunday",
		]) {
			const row = byDay.get(day);
			if (!row?.isWorkDay) continue;
			const hours = Math.floor(row.minutesPerDay / 60);
			const mins = row.minutesPerDay % 60;
			const dur = mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
			const clockIn = row.latestClockIn ? ` (${row.latestClockIn})` : "";
			parts.push(`${DAY_SHORT[day] ?? day} ${dur}${clockIn}`);
		}
		return parts.length > 0 ? parts.join(", ") : null;
	};
	const currentGrid = serializeGrid(currentContract.weeklyScheduleDays);
	const projectedGrid = serializeGrid(projectedContract.weeklyScheduleDays);
	const currentGridLabel = formatScheduleDaysLabel(currentContract.weeklyScheduleDays);
	const projectedGridLabel = formatScheduleDaysLabel(projectedContract.weeklyScheduleDays);

	const extractWorkDaySummaries = (
		days: readonly {
			readonly dayOfWeek: DayOfWeek;
			readonly isWorkDay: boolean;
			readonly minutesPerDay: number;
			readonly latestClockIn: string | null;
		}[],
	): PrimaryTeamMoveScheduleDaySummary[] => {
		const byDay = new Map(days.map((d) => [d.dayOfWeek, d]));
		const out: PrimaryTeamMoveScheduleDaySummary[] = [];
		for (const day of CANONICAL_DAY_ORDER) {
			const row = byDay.get(day);
			if (!row?.isWorkDay) continue;
			out.push({
				dayOfWeek: day,
				minutesPerDay: row.minutesPerDay,
				latestClockIn: row.latestClockIn,
			});
		}
		return out;
	};
	const currentScheduleDays = extractWorkDaySummaries(currentContract.weeklyScheduleDays);
	const projectedScheduleDays = extractWorkDaySummaries(projectedContract.weeklyScheduleDays);

	const comparisons: PrimaryTeamMoveOperationalChange[] = [
		{
			field: "workPolicy",
			before: currentContract.workPolicy?.policyId ?? null,
			after: projectedContract.workPolicy?.policyId ?? null,
			beforeLabel: currentContract.workPolicy?.policyName ?? null,
			afterLabel: projectedContract.workPolicy?.policyName ?? null,
			beforeSource: currentContract.workPolicySource,
			afterSource: projectedContract.workPolicySource,
		},
		{
			field: "weeklyContractMinutes",
			before: currentContract.weeklyContractMinutes,
			after: projectedContract.weeklyContractMinutes,
			beforeLabel:
				currentContract.weeklyContractMinutes !== null
					? `${currentContract.weeklyContractMinutes} min`
					: null,
			afterLabel:
				projectedContract.weeklyContractMinutes !== null
					? `${projectedContract.weeklyContractMinutes} min`
					: null,
			beforeSource: currentContract.weeklyContractMinutesSource,
			afterSource: projectedContract.weeklyContractMinutesSource,
		},
		{
			field: "scheduleMode",
			before: currentContract.scheduleMode,
			after: projectedContract.scheduleMode,
			beforeLabel: currentContract.scheduleMode,
			afterLabel: projectedContract.scheduleMode,
			beforeSource: currentContract.scheduleModeSource,
			afterSource: projectedContract.scheduleModeSource,
		},
		{
			field: "weeklyScheduleDays",
			before: currentGrid || null,
			after: projectedGrid || null,
			beforeLabel: currentGridLabel,
			afterLabel: projectedGridLabel,
			beforeScheduleDays: currentScheduleDays,
			afterScheduleDays: projectedScheduleDays,
			beforeSource: currentContract.scheduleModeSource,
			afterSource: projectedContract.scheduleModeSource,
		},
		{
			field: "workModel",
			before: currentContract.workModel,
			after: projectedContract.workModel,
			beforeLabel: currentContract.workModel,
			afterLabel: projectedContract.workModel,
			beforeSource: currentContract.workModelSource,
			afterSource: projectedContract.workModelSource,
		},
		{
			field: "presenceOverride",
			before: currentContract.presenceOverride,
			after: projectedContract.presenceOverride,
			beforeLabel: currentContract.presenceOverride,
			afterLabel: projectedContract.presenceOverride,
			beforeSource: currentContract.presenceOverrideSource,
			afterSource: projectedContract.presenceOverrideSource,
		},
		{
			field: "presenceStatus",
			before: currentContract.presenceStatus,
			after: projectedContract.presenceStatus,
			beforeLabel: currentContract.presenceStatus,
			afterLabel: projectedContract.presenceStatus,
			beforeSource: currentContract.presenceOverrideSource,
			afterSource: projectedContract.presenceOverrideSource,
		},
		{
			field: "balanceMode",
			before: currentContract.balanceMode,
			after: projectedContract.balanceMode,
			beforeLabel: currentContract.balanceMode,
			afterLabel: projectedContract.balanceMode,
			beforeSource: currentContract.balanceModeSource,
			afterSource: projectedContract.balanceModeSource,
		},
		{
			field: "scheduleSource",
			before: currentContract.scheduleSource,
			after: projectedContract.scheduleSource,
			beforeLabel: currentContract.scheduleSource,
			afterLabel: projectedContract.scheduleSource,
			beforeSource: currentContract.scheduleSourceSource,
			afterSource: projectedContract.scheduleSourceSource,
		},
	];

	const changes: PrimaryTeamMoveOperationalChange[] = [];
	const preservedPersonalDivergences: string[] = [];

	for (const entry of comparisons) {
		if (entry.before !== entry.after) {
			changes.push(entry);
		} else if (entry.field !== "presenceStatus" && entry.afterSource === "employee_override") {
			preservedPersonalDivergences.push(entry.field);
		}
	}

	const currentTeamId = currentContract.primaryTeamId ?? empRow.teamId;

	return {
		employeeId: input.employeeId,
		effectiveOnDate,
		currentPrimaryTeamId: currentTeamId,
		currentPrimaryTeamName: currentTeamId ? (teamNames.get(currentTeamId) ?? null) : null,
		targetPrimaryTeamId: input.targetTeamId,
		targetPrimaryTeamName: input.targetTeamId ? (teamNames.get(input.targetTeamId) ?? null) : null,
		hasOperationalChanges: changes.length > 0,
		changes,
		preservedPersonalDivergences,
		preservedEmployeeOwnedTerms: {
			contractType: projectedContract.contractType,
			employmentProfile: projectedContract.employmentProfile,
			arbzgScope: projectedContract.arbzgScope,
			onCallTerms: projectedContract.onCallTerms,
		},
		mismatchWarning: projectedContract.mismatchWarning,
		currentContract,
		projectedContract,
	};
}
