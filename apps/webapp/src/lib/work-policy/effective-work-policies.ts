import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
	contractDefault,
	contractTemplateVersion,
	employee,
	employeeEmploymentHistory,
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
import {
	loadEffectiveContractsBatch,
	normalizeHoursToMinutes,
	type ResolvedWorkPolicyPresence,
	type ResolvedWorkPolicyRegulation,
	type ResolvedWorkPolicySchedule,
	type ResolvedWorkPolicyVersion,
	selectActivePolicyVersionOnDay,
	type WorkPolicySnapshot,
	type WorkPolicyVersionSnapshot,
} from "@/lib/contracts";
import { dateFromInstant, type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import { termsCalendarDate } from "@/lib/employment-history/terms-in-force";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

export type WorkPolicyWithDetails = typeof workPolicy.$inferSelect & {
	schedule:
		| (typeof workPolicySchedule.$inferSelect & {
				days: (typeof workPolicyScheduleDay.$inferSelect)[];
		  })
		| null;
	regulation:
		| (typeof workPolicyRegulation.$inferSelect & {
				breakRules: (typeof workPolicyBreakRule.$inferSelect & {
					options: (typeof workPolicyBreakOption.$inferSelect)[];
				})[];
		  })
		| null;
};

/** Converts a unified resolver's `ResolvedWorkPolicyVersion` into the legacy `EffectiveWorkPolicy` shape. */
export function resolvedPolicyVersionToEffectiveWorkPolicy(
	resolved: ResolvedWorkPolicyVersion,
): EffectiveWorkPolicy {
	return {
		policyId: resolved.policyId,
		policyVersionId: resolved.policyVersionId,
		policyName: resolved.policyName,
		schedule:
			resolved.scheduleEnabled && resolved.schedule
				? {
						scheduleCycle: resolved.schedule.scheduleCycle,
						scheduleType: resolved.schedule.scheduleType,
						workingDaysPreset: resolved.schedule.workingDaysPreset,
						hoursPerCycle: resolved.schedule.hoursPerCycle,
						homeOfficeDaysPerCycle: resolved.schedule.homeOfficeDaysPerCycle,
						days: resolved.schedule.days.map((d) => ({
							dayOfWeek: d.dayOfWeek,
							hoursPerDay: d.hoursPerDay,
							isWorkDay: d.isWorkDay,
							latestClockIn: d.latestClockIn,
						})),
					}
				: null,
		regulation:
			resolved.regulationEnabled && resolved.regulation
				? {
						maxDailyMinutes: resolved.regulation.maxDailyMinutes,
						maxWeeklyMinutes: resolved.regulation.maxWeeklyMinutes,
						maxUninterruptedMinutes: resolved.regulation.maxUninterruptedMinutes,
						minRestPeriodMinutes: resolved.regulation.minRestPeriodMinutes,
						restPeriodEnforcement: resolved.regulation.restPeriodEnforcement,
						overtimeDailyThresholdMinutes: resolved.regulation.overtimeDailyThresholdMinutes,
						overtimeWeeklyThresholdMinutes: resolved.regulation.overtimeWeeklyThresholdMinutes,
						overtimeMonthlyThresholdMinutes: resolved.regulation.overtimeMonthlyThresholdMinutes,
						alertBeforeLimitMinutes: resolved.regulation.alertBeforeLimitMinutes,
						alertThresholdPercent: resolved.regulation.alertThresholdPercent,
						breakRules: resolved.regulation.breakRules.map((rule) => ({
							workingMinutesThreshold: rule.workingMinutesThreshold,
							requiredBreakMinutes: rule.requiredBreakMinutes,
							options: rule.options.map((opt) => ({
								splitCount: opt.splitCount,
								minimumSplitMinutes: opt.minimumSplitMinutes,
								minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
							})),
						})),
					}
				: null,
		assignmentType: resolved.assignmentType,
		assignedVia: resolved.assignedVia,
	};
}

/** A policy row with its details, as the effective policy every resolver returns. */
export function toEffectiveWorkPolicy(
	policy: WorkPolicyWithDetails,
	assignmentType: "organization" | "team" | "employee",
	assignedVia: string,
	policyVersionId: string | null = null,
): EffectiveWorkPolicy {
	return {
		policyId: policy.id,
		policyVersionId,
		policyName: policy.name,
		schedule:
			policy.scheduleEnabled && policy.schedule
				? {
						scheduleCycle: policy.schedule.scheduleCycle,
						scheduleType: policy.schedule.scheduleType,
						workingDaysPreset: policy.schedule.workingDaysPreset,
						hoursPerCycle: policy.schedule.hoursPerCycle,
						homeOfficeDaysPerCycle: policy.schedule.homeOfficeDaysPerCycle ?? 0,
						days: policy.schedule.days.map((d) => ({
							dayOfWeek: d.dayOfWeek,
							hoursPerDay: d.hoursPerDay,
							isWorkDay: d.isWorkDay,
							latestClockIn: d.latestClockIn ?? null,
						})),
					}
				: null,
		regulation:
			policy.regulationEnabled && policy.regulation
				? {
						maxDailyMinutes: policy.regulation.maxDailyMinutes,
						maxWeeklyMinutes: policy.regulation.maxWeeklyMinutes,
						maxUninterruptedMinutes: policy.regulation.maxUninterruptedMinutes,
						minRestPeriodMinutes: policy.regulation.minRestPeriodMinutes,
						restPeriodEnforcement: policy.regulation.restPeriodEnforcement ?? "warn",
						overtimeDailyThresholdMinutes: policy.regulation.overtimeDailyThresholdMinutes,
						overtimeWeeklyThresholdMinutes: policy.regulation.overtimeWeeklyThresholdMinutes,
						overtimeMonthlyThresholdMinutes: policy.regulation.overtimeMonthlyThresholdMinutes,
						alertBeforeLimitMinutes: policy.regulation.alertBeforeLimitMinutes ?? 30,
						alertThresholdPercent: policy.regulation.alertThresholdPercent ?? 80,
						breakRules: policy.regulation.breakRules
							.sort((a, b) => a.sortOrder - b.sortOrder)
							.map((rule) => ({
								workingMinutesThreshold: rule.workingMinutesThreshold,
								requiredBreakMinutes: rule.requiredBreakMinutes,
								options: rule.options
									.sort((a, b) => a.sortOrder - b.sortOrder)
									.map((opt) => ({
										splitCount: opt.splitCount,
										minimumSplitMinutes: opt.minimumSplitMinutes,
										minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
									})),
							})),
					}
				: null,
		assignmentType,
		assignedVia,
	};
}

/** The assignment fields the precedence rule reads. */
export interface PolicyAssignmentCandidate {
	assignmentType: "organization" | "team" | "employee";
	employeeId: string | null;
	teamId: string | null;
}

/**
 * The precedence rule: the first usable candidate at employee level, then at
 * the person's primary team, then at organization level. Candidates must come
 * ordered as `orderEffectiveAssignments` orders them; within a level an
 * unusable candidate (inactive or foreign policy) falls through to the next.
 */
export function pickEffectiveAssignment<Candidate extends PolicyAssignmentCandidate>(
	orderedCandidates: readonly Candidate[],
	person: { id: string; teamId: string | null },
	usable: (candidate: Candidate) => boolean,
): Candidate | undefined {
	const levels = [
		(candidate: Candidate) =>
			candidate.assignmentType === "employee" && candidate.employeeId === person.id,
		(candidate: Candidate) =>
			person.teamId !== null &&
			candidate.assignmentType === "team" &&
			candidate.teamId === person.teamId,
		(candidate: Candidate) => candidate.assignmentType === "organization",
	];
	for (const atLevel of levels) {
		const found = orderedCandidates.find((candidate) => atLevel(candidate) && usable(candidate));
		if (found) return found;
	}
	return undefined;
}

/**
 * The newest assignment first, the same order the single-employee resolver
 * uses, so batched and single resolution pick the same candidate.
 */
export function orderEffectiveAssignments(
	assignment: Pick<typeof workPolicyAssignment, "effectiveFrom" | "createdAt" | "id">,
	operators: { desc: typeof desc; sql: typeof sql } = { desc, sql },
) {
	return [
		operators.sql`${assignment.effectiveFrom} desc nulls last`,
		operators.desc(assignment.createdAt),
		operators.desc(assignment.id),
	];
}

function parseFixedDays(raw: string | null): ResolvedWorkPolicyPresence["requiredOnsiteFixedDays"] {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed as ResolvedWorkPolicyPresence["requiredOnsiteFixedDays"];
	} catch {
		return null;
	}
}

async function loadPolicySnapshotsByIds(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	policyIds: readonly string[],
): Promise<Map<string, WorkPolicySnapshot>> {
	const uniqueIds = [...new Set(policyIds)];
	if (uniqueIds.length === 0) return new Map();

	const [policyRows, versionRows] = await Promise.all([
		db
			.select()
			.from(workPolicy)
			.where(and(eq(workPolicy.organizationId, organizationId), inArray(workPolicy.id, uniqueIds))),
		db
			.select()
			.from(workPolicyVersion)
			.where(
				and(
					eq(workPolicyVersion.organizationId, organizationId),
					inArray(workPolicyVersion.policyId, uniqueIds),
				),
			),
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
					.orderBy(asc(workPolicyBreakRule.sortOrder))
			: Promise.resolve([]),
	]);

	const breakRuleIds = breakRuleRows.map((r) => r.id);
	const breakOptionRows =
		breakRuleIds.length > 0
			? await db
					.select()
					.from(workPolicyBreakOption)
					.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds))
					.orderBy(asc(workPolicyBreakOption.sortOrder))
			: [];

	const daysByScheduleId = Map.groupBy(scheduleDayRows, (d) => d.scheduleId);
	const optionsByRuleId = Map.groupBy(breakOptionRows, (o) => o.breakRuleId);
	const rulesByRegulationId = Map.groupBy(breakRuleRows, (r) => r.regulationId);

	const scheduleByVersionId = new Map<string, ResolvedWorkPolicySchedule>();
	for (const row of scheduleRows) {
		if (!row.policyVersionId) continue;
		scheduleByVersionId.set(row.policyVersionId, {
			id: row.id,
			scheduleCycle: row.scheduleCycle,
			scheduleType: row.scheduleType,
			workingDaysPreset: row.workingDaysPreset,
			hoursPerCycle: row.hoursPerCycle,
			normalizedCycleMinutes: normalizeHoursToMinutes(row.hoursPerCycle),
			homeOfficeDaysPerCycle: row.homeOfficeDaysPerCycle ?? 0,
			days: (daysByScheduleId.get(row.id) ?? []).map((day) => ({
				dayOfWeek: day.dayOfWeek,
				hoursPerDay: day.hoursPerDay,
				minutesPerDay: normalizeHoursToMinutes(day.hoursPerDay) ?? 0,
				isWorkDay: day.isWorkDay,
				cycleWeek: day.cycleWeek ?? 1,
				latestClockIn: day.latestClockIn ?? null,
			})),
		});
	}

	const regulationByVersionId = new Map<string, ResolvedWorkPolicyRegulation>();
	for (const row of regulationRows) {
		if (!row.policyVersionId) continue;
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
			breakRules: (rulesByRegulationId.get(row.id) ?? []).map((rule) => ({
				id: rule.id,
				workingMinutesThreshold: rule.workingMinutesThreshold,
				requiredBreakMinutes: rule.requiredBreakMinutes,
				options: (optionsByRuleId.get(rule.id) ?? []).map((opt) => ({
					splitCount: opt.splitCount,
					minimumSplitMinutes: opt.minimumSplitMinutes,
					minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
				})),
			})),
		});
	}

	const presenceByVersionId = new Map<string, ResolvedWorkPolicyPresence>();
	for (const row of presenceRows) {
		if (!row.policyVersionId) continue;
		presenceByVersionId.set(row.policyVersionId, {
			id: row.id,
			presenceMode: row.presenceMode,
			requiredOnsiteDays: row.requiredOnsiteDays,
			requiredOnsiteFixedDays: parseFixedDays(row.requiredOnsiteFixedDays),
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

	const map = new Map<string, WorkPolicySnapshot>();
	for (const p of policyRows) {
		map.set(p.id, {
			id: p.id,
			name: p.name,
			isActive: p.isActive,
			scheduleEnabled: p.scheduleEnabled,
			regulationEnabled: p.regulationEnabled,
			presenceEnabled: p.presenceEnabled,
			versions: versionsByPolicyId.get(p.id) ?? [],
		});
	}
	return map;
}

/**
 * Many employees' (and draft invitees') effective work policies as of `at`, resolved
 * version-scoped via `work_policy_version` (confirmed terms override -> employee assignment
 * -> primary team default/assignment -> organization default/assignment; inactive policies
 * fall through). The caller supplies each subject's primary team so draft invitees resolve
 * by their draft team without needing an `employee` row.
 */
export async function loadEffectiveWorkPolicies(
	db: DatabaseClient,
	input: {
		organizationId: string;
		employees: readonly { id: string; teamId: string | null }[];
		at: Instant;
	},
): Promise<Map<string, EffectiveWorkPolicy | null>> {
	const resolved = new Map<string, EffectiveWorkPolicy | null>();
	if (input.employees.length === 0) return resolved;

	const at = dateFromInstant(input.at);
	const orgTimezone = await loadOrganizationTimezone(db, input.organizationId);
	const orgDay = plainDateAt(input.at, orgTimezone);
	const employeeIds = [...new Set(input.employees.map((person) => person.id))];

	// A3-16: Compute each real employee's own local calendar date at `at` (matching clock-out's
	// personal -> organization -> UTC timezone resolution) instead of forcing every employee onto
	// the organization's date.
	const employeeTzRows = await db
		.select({
			id: employee.id,
			userTimezone: userSettings.timezone,
		})
		.from(employee)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
		);
	const dayStrByEmployeeId = new Map<string, string>();
	const uniqueDaysByStr = new Map<string, ReturnType<typeof plainDateAt>>();
	uniqueDaysByStr.set(orgDay.toString(), orgDay);
	for (const row of employeeTzRows) {
		const empTz = resolveEffectiveTimezone(row.userTimezone, orgTimezone);
		const empDay = plainDateAt(input.at, empTz);
		const empDayStr = empDay.toString();
		dayStrByEmployeeId.set(row.id, empDayStr);
		if (!uniqueDaysByStr.has(empDayStr)) {
			uniqueDaysByStr.set(empDayStr, empDay);
		}
	}

	// Resolve real employees through the unified read-only contract resolver using captured
	// `employee_team_history` (never overriding real employees with caller's current `teamId` — A1-11).
	const batch = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds,
		dates: [...uniqueDaysByStr.values()],
		at: input.at,
	});

	const syntheticTargets: { id: string; teamId: string | null }[] = [];
	for (const person of input.employees) {
		const perDate = batch.get(person.id);
		if (perDate) {
			const empDayStr = dayStrByEmployeeId.get(person.id) ?? orgDay.toString();
			const contract = perDate.get(empDayStr);
			resolved.set(
				person.id,
				contract?.workPolicy
					? resolvedPolicyVersionToEffectiveWorkPolicy(contract.workPolicy)
					: null,
			);
		} else {
			syntheticTargets.push(person);
		}
	}

	if (syntheticTargets.length === 0) {
		return resolved;
	}
	const dayStr = orgDay.toString();

	const syntheticIds = [...new Set(syntheticTargets.map((person) => person.id))];
	const teamIds = [
		...new Set(syntheticTargets.flatMap((person) => (person.teamId ? [person.teamId] : []))),
	];

	const [candidates, defaultRows, termsRows, teamRows] = await Promise.all([
		db
			.select({
				id: workPolicyAssignment.id,
				policyId: workPolicyAssignment.policyId,
				assignmentType: workPolicyAssignment.assignmentType,
				teamId: workPolicyAssignment.teamId,
				employeeId: workPolicyAssignment.employeeId,
				effectiveFrom: workPolicyAssignment.effectiveFrom,
				effectiveUntil: workPolicyAssignment.effectiveUntil,
				createdAt: workPolicyAssignment.createdAt,
			})
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, input.organizationId),
					eq(workPolicyAssignment.isActive, true),
					or(
						isNull(workPolicyAssignment.effectiveFrom),
						lte(workPolicyAssignment.effectiveFrom, at),
					),
					or(
						isNull(workPolicyAssignment.effectiveUntil),
						gt(workPolicyAssignment.effectiveUntil, at),
					),
					or(
						eq(workPolicyAssignment.assignmentType, "organization"),
						teamIds.length
							? and(
									eq(workPolicyAssignment.assignmentType, "team"),
									inArray(workPolicyAssignment.teamId, teamIds),
								)
							: undefined,
						and(
							eq(workPolicyAssignment.assignmentType, "employee"),
							inArray(workPolicyAssignment.employeeId, syntheticIds),
						),
					),
				),
			)
			.orderBy(
				sql`${workPolicyAssignment.effectiveFrom} desc nulls last`,
				desc(workPolicyAssignment.createdAt),
				desc(workPolicyAssignment.id),
			),
		db
			.select({
				id: contractDefault.id,
				scope: contractDefault.scope,
				teamId: contractDefault.teamId,
				effectiveFromDate: contractDefault.effectiveFromDate,
				effectiveUntilDate: contractDefault.effectiveUntilDate,
				createdAt: contractDefault.createdAt,
				workPolicyId: contractTemplateVersion.workPolicyId,
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
				id: employeeEmploymentHistory.id,
				employeeId: employeeEmploymentHistory.employeeId,
				workPolicyId: employeeEmploymentHistory.workPolicyId,
				validFrom: employeeEmploymentHistory.validFrom,
				validUntil: employeeEmploymentHistory.validUntil,
				validFromDate: employeeEmploymentHistory.validFromDate,
				validUntilDate: employeeEmploymentHistory.validUntilDate,
				createdAt: employeeEmploymentHistory.createdAt,
			})
			.from(employeeEmploymentHistory)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					inArray(employeeEmploymentHistory.employeeId, syntheticIds),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
				),
			)
			.orderBy(asc(employeeEmploymentHistory.validFrom), asc(employeeEmploymentHistory.createdAt)),
		teamIds.length > 0
			? db
					.select({ id: team.id, name: team.name })
					.from(team)
					.where(and(eq(team.organizationId, input.organizationId), inArray(team.id, teamIds)))
			: Promise.resolve([]),
	]);

	const teamNames = new Map(teamRows.map((t) => [t.id, t.name]));
	const allPolicyIds = [
		...candidates.map((c) => c.policyId),
		...defaultRows.flatMap((d) => (d.workPolicyId ? [d.workPolicyId] : [])),
		...termsRows.flatMap((t) => (t.workPolicyId ? [t.workPolicyId] : [])),
	];
	const policiesById = await loadPolicySnapshotsByIds(db, input.organizationId, allPolicyIds);

	const termsByEmployee = Map.groupBy(termsRows, (r) => r.employeeId);
	const pickDefaultPolicyId = (scope: "organization" | "team", teamId: string | null) => {
		const matching = defaultRows
			.filter(
				(row) =>
					row.scope === scope &&
					(scope !== "team" || row.teamId === teamId) &&
					row.workPolicyId !== null &&
					row.effectiveFromDate <= dayStr &&
					(row.effectiveUntilDate === null || row.effectiveUntilDate > dayStr),
			)
			.sort((a, b) => {
				if (b.effectiveFromDate !== a.effectiveFromDate) {
					return b.effectiveFromDate.localeCompare(a.effectiveFromDate);
				}
				const createdCmp = b.createdAt.getTime() - a.createdAt.getTime();
				if (createdCmp !== 0) return createdCmp;
				return b.id.localeCompare(a.id);
			});
		for (const row of matching) {
			if (row.workPolicyId && policiesById.get(row.workPolicyId)?.isActive) {
				return row.workPolicyId;
			}
		}
		return null;
	};

	const activeTermsPolicyForEmployee = (employeeId: string): string | null => {
		const rows = termsByEmployee.get(employeeId) ?? [];
		const matching = rows.filter((row) => {
			const from = row.validFromDate ?? termsCalendarDate(row.validFrom, orgTimezone).toString();
			const until =
				row.validUntilDate ??
				(row.validUntil ? termsCalendarDate(row.validUntil, orgTimezone).toString() : null);
			return from <= dayStr && (until === null || dayStr < until);
		});
		const latest = matching.at(-1);
		return latest?.workPolicyId ?? null;
	};

	for (const person of syntheticTargets) {
		let chosenVersion: ResolvedWorkPolicyVersion | null = null;

		// 1. Confirmed terms workPolicyId override
		const termsPolicyId = activeTermsPolicyForEmployee(person.id);
		if (termsPolicyId) {
			const policy = policiesById.get(termsPolicyId);
			if (policy?.isActive) {
				chosenVersion = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "employee",
					assignmentId: null,
					assignedVia: "Contract override",
				});
			}
		}

		// 2. Employee assignment -> Team default/assignment -> Org default/assignment
		if (!chosenVersion) {
			const empAssignment = candidates.find(
				(c) =>
					c.assignmentType === "employee" &&
					c.employeeId === person.id &&
					policiesById.get(c.policyId)?.isActive,
			);
			if (empAssignment) {
				const policy = policiesById.get(empAssignment.policyId)!;
				chosenVersion = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "employee",
					assignmentId: empAssignment.id,
					assignedVia: assignedViaLabel("employee"),
				});
			}
		}

		if (!chosenVersion && person.teamId) {
			const teamDefId = pickDefaultPolicyId("team", person.teamId);
			if (teamDefId) {
				const policy = policiesById.get(teamDefId)!;
				chosenVersion = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "team",
					assignmentId: null,
					assignedVia: assignedViaLabel("team", teamNames.get(person.teamId)),
				});
			}
		}

		if (!chosenVersion && person.teamId) {
			const teamAssignment = candidates.find(
				(c) =>
					c.assignmentType === "team" &&
					c.teamId === person.teamId &&
					policiesById.get(c.policyId)?.isActive,
			);
			if (teamAssignment) {
				const policy = policiesById.get(teamAssignment.policyId)!;
				chosenVersion = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "team",
					assignmentId: teamAssignment.id,
					assignedVia: assignedViaLabel("team", teamNames.get(person.teamId)),
				});
			}
		}

		if (!chosenVersion) {
			const orgDefId = pickDefaultPolicyId("organization", null);
			if (orgDefId) {
				const policy = policiesById.get(orgDefId)!;
				chosenVersion = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "organization",
					assignmentId: null,
					assignedVia: assignedViaLabel("organization"),
				});
			}
		}

		if (!chosenVersion) {
			const orgAssignment = candidates.find(
				(c) => c.assignmentType === "organization" && policiesById.get(c.policyId)?.isActive,
			);
			if (orgAssignment) {
				const policy = policiesById.get(orgAssignment.policyId)!;
				chosenVersion = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "organization",
					assignmentId: orgAssignment.id,
					assignedVia: assignedViaLabel("organization"),
				});
			}
		}

		resolved.set(
			person.id,
			chosenVersion ? resolvedPolicyVersionToEffectiveWorkPolicy(chosenVersion) : null,
		);
	}

	return resolved;
}

/** The `assignedVia` label the single-employee resolver gives each level. */
export function assignedViaLabel(
	assignmentType: "organization" | "team" | "employee",
	teamName?: string | null,
): string {
	if (assignmentType === "employee") return "Individual";
	if (assignmentType === "team") return teamName ?? "Team";
	return "Organization Default";
}
