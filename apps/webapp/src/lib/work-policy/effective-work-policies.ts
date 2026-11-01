import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
	type workPolicy,
	workPolicyAssignment,
	type workPolicyBreakOption,
	type workPolicyBreakRule,
	type workPolicyRegulation,
	type workPolicySchedule,
	type workPolicyScheduleDay,
} from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";

/** The relations a resolved policy needs: schedule days and regulation break rules. */
export const WORK_POLICY_DETAILS_WITH = {
	schedule: {
		with: { days: true },
	},
	regulation: {
		with: {
			breakRules: {
				with: { options: true },
			},
		},
	},
} as const;

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

/** A policy row with its details, as the effective policy every resolver returns. */
export function toEffectiveWorkPolicy(
	policy: WorkPolicyWithDetails,
	assignmentType: "organization" | "team" | "employee",
	assignedVia: string,
): EffectiveWorkPolicy {
	return {
		policyId: policy.id,
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
						// ArbZG compliance fields
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

/**
 * Many employees' effective work policies as of `at`, resolved exactly like
 * `WorkPolicyService.getEffectivePolicyAt` (employee, then primary team, then
 * organization; half-open windows; inactive policies fall through), in one
 * organization-scoped query whatever the number of employees. The caller
 * supplies each employee's primary team; employee rows are not read here.
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
	const employeeIds = [...new Set(input.employees.map((person) => person.id))];
	const teamIds = [
		...new Set(input.employees.flatMap((person) => (person.teamId ? [person.teamId] : []))),
	];
	const candidates = await db.query.workPolicyAssignment.findMany({
		where: and(
			eq(workPolicyAssignment.organizationId, input.organizationId),
			eq(workPolicyAssignment.isActive, true),
			or(isNull(workPolicyAssignment.effectiveFrom), lte(workPolicyAssignment.effectiveFrom, at)),
			or(isNull(workPolicyAssignment.effectiveUntil), gt(workPolicyAssignment.effectiveUntil, at)),
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
					inArray(workPolicyAssignment.employeeId, employeeIds),
				),
			),
		),
		with: {
			policy: { with: WORK_POLICY_DETAILS_WITH },
			team: { columns: { name: true } },
		},
		orderBy: orderEffectiveAssignments,
	});

	for (const person of input.employees) {
		const chosen = pickEffectiveAssignment(
			candidates,
			person,
			(candidate) =>
				Boolean(candidate.policy?.isActive) &&
				candidate.policy?.organizationId === input.organizationId,
		);
		resolved.set(
			person.id,
			chosen?.policy
				? toEffectiveWorkPolicy(
						chosen.policy as WorkPolicyWithDetails,
						chosen.assignmentType,
						assignedViaLabel(chosen.assignmentType, chosen.team?.name),
					)
				: null,
		);
	}
	return resolved;
}

/** The `assignedVia` label the single-employee resolver gives each level. */
export function assignedViaLabel(
	assignmentType: "organization" | "team" | "employee",
	teamName: string | null | undefined,
): string {
	if (assignmentType === "employee") return "Individual";
	if (assignmentType === "team") return teamName ?? "Team";
	return "Organization Default";
}
