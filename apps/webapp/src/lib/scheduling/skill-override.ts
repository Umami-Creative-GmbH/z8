import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { db as appDb } from "@/db";
import { skillRequirementOverride } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import { shiftCalendarDate } from "./shift-date";
import { SKILL_OVERRIDE_REASON_REQUIRED } from "./skill-override-refusal";
import {
	loadSkillValidation,
	type SkillValidationResult,
	unmetRequiredSkillIds,
} from "./skill-validation";

/**
 * **Skill overrides** (#893): assigning an employee to a shift while a required
 * skill is missing or expired on the shift date takes the planner's reason, and records it in
 * the transaction that assigns the employee. Every assignment path decides through
 * `decideSkillOverride` inside its own transaction, so the check runs at commit time and the
 * override commits or rolls back with the assignment. Preferred skills never need a reason.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Who works the shift, when and where. Changing any part is a new assignment context, which
 * needs its own override; notes and times are not part of it.
 */
export interface AssignmentContext {
	employeeId: string;
	/** `shift.date` as stored: the organization-local midnight. */
	shiftDate: Date;
	subareaId: string;
	templateId: string | null;
}

export type SkillOverrideDecision =
	/** Every required skill is held, or an override already covers this unchanged context. */
	| { kind: "none" }
	| { kind: "reason_required"; missingSkillIds: string[] }
	| { kind: "record"; missingSkillIds: string[]; reason: string };

const storedSkillIdsSchema = z.array(z.string());

/** The planner's reason, trimmed; null when blank. */
export function overrideReasonOf(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function sameAssignmentContext(
	left: AssignmentContext | null,
	right: AssignmentContext,
): boolean {
	return (
		left !== null &&
		left.employeeId === right.employeeId &&
		left.shiftDate.getTime() === right.shiftDate.getTime() &&
		left.subareaId === right.subareaId &&
		left.templateId === right.templateId
	);
}

/** Refuses an assignment whose unmet required skills got no reason. */
export function skillOverrideReasonRequiredError(missingSkillIds: readonly string[]) {
	return new ValidationError({
		message: "Give a reason to assign an employee without every required skill",
		field: "skillOverrideReason",
		value: [...missingSkillIds],
		refusal: SKILL_OVERRIDE_REASON_REQUIRED,
	});
}

/**
 * Checks the employee against the shift's skill requirements on the shift date and decides
 * whether the assignment records an override. `previous` is the shift's context before this
 * write (null for a new shift or a newly assigned employee): only an unchanged context can be
 * covered by its latest override, and only for skills that override already lists. Callers
 * verify that the shift, employee, subarea and template belong to the organization.
 */
export async function decideSkillOverride(
	tx: Transaction,
	input: {
		organizationId: string;
		organizationTimezone: string;
		shiftId: string | null;
		context: AssignmentContext;
		previous: AssignmentContext | null;
		reason: string | null | undefined;
	},
): Promise<{ validation: SkillValidationResult; decision: SkillOverrideDecision }> {
	const { context } = input;
	const validation = await loadSkillValidation(tx, {
		organizationId: input.organizationId,
		employeeId: context.employeeId,
		subareaId: context.subareaId,
		templateId: context.templateId,
		// Skills count on the shift date in the organization's calendar (#1142).
		shiftDate: shiftCalendarDate(context.shiftDate, input.organizationTimezone).toString(),
	});
	const missingSkillIds = unmetRequiredSkillIds(validation);
	if (missingSkillIds.length === 0) return { validation, decision: { kind: "none" } };

	if (input.shiftId && sameAssignmentContext(input.previous, context)) {
		const [latest] = await tx
			.select()
			.from(skillRequirementOverride)
			.where(
				and(
					eq(skillRequirementOverride.organizationId, input.organizationId),
					eq(skillRequirementOverride.shiftId, input.shiftId),
				),
			)
			.orderBy(desc(skillRequirementOverride.overriddenAt), desc(skillRequirementOverride.id))
			.limit(1);
		// Overrides from before #893 recorded no context, so they cover none.
		if (latest?.shiftDate && latest.subareaId) {
			const covered = new Set(storedSkillIdsSchema.parse(JSON.parse(latest.missingSkillIds)));
			const recorded: AssignmentContext = {
				employeeId: latest.employeeId,
				shiftDate: latest.shiftDate,
				subareaId: latest.subareaId,
				templateId: latest.templateId,
			};
			if (
				sameAssignmentContext(recorded, context) &&
				missingSkillIds.every((id) => covered.has(id))
			) {
				return { validation, decision: { kind: "none" } };
			}
		}
	}

	const reason = overrideReasonOf(input.reason);
	return {
		validation,
		decision: reason
			? { kind: "record", missingSkillIds, reason }
			: { kind: "reason_required", missingSkillIds },
	};
}

/** Records the override; call it in the transaction that writes the assignment. */
export async function insertSkillOverride(
	tx: Transaction,
	input: {
		organizationId: string;
		shiftId: string;
		context: AssignmentContext;
		missingSkillIds: readonly string[];
		reason: string;
		/** The authenticated planner's user id, never a client value. */
		overriddenBy: string;
	},
) {
	const [row] = await tx
		.insert(skillRequirementOverride)
		.values({
			organizationId: input.organizationId,
			shiftId: input.shiftId,
			employeeId: input.context.employeeId,
			missingSkillIds: JSON.stringify(input.missingSkillIds),
			shiftDate: input.context.shiftDate,
			subareaId: input.context.subareaId,
			templateId: input.context.templateId,
			overrideReason: input.reason,
			overriddenBy: input.overriddenBy,
		})
		.returning();
	return row;
}
