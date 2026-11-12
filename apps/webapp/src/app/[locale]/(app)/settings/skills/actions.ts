"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath, revalidateTag } from "next/cache";
import * as z from "zod";
import { employee } from "@/db/schema";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type EmployeeSkillWithDetails,
	SkillService,
	type SkillWithRelations,
} from "@/lib/effect/services/skill.service";
import { validateExpiryReminderLeadDays } from "@/lib/expiry-reminders/expiry";
import { createLogger } from "@/lib/logger";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { saveSkillReminderLeadDays as saveSkillReminderLeadDaysToStore } from "@/lib/scheduling/skill-reminder-store";

const logger = createLogger("SkillActions");

// =============================================================================
// Input schemas
// =============================================================================

const id = z.string().min(1);

const skillCategory = z.enum([
	"safety",
	"equipment",
	"certification",
	"training",
	"language",
	"custom",
]);

const createSkillSchema = z.strictObject({
	name: z.string().trim().min(1, "Skill name is required").max(255),
	description: z.string().optional(),
	category: skillCategory,
	customCategoryName: z.string().optional(),
	requiresExpiry: z.boolean(),
});

const updateSkillSchema = z.strictObject({
	skillId: id,
	data: z.strictObject({
		name: z.string().trim().min(1, "Skill name is required").max(255).optional(),
		description: z.string().optional(),
		category: skillCategory.optional(),
		customCategoryName: z.string().optional(),
		requiresExpiry: z.boolean().optional(),
		isActive: z.boolean().optional(),
	}),
});

const employeeSkillSchema = z.strictObject({ employeeId: id, skillId: id });

const skillRequirements = z.array(z.strictObject({ skillId: id, isRequired: z.boolean() }));

/** The lead time as the reminder rule reads it (1–365 days), never trusting the client. */
const leadDays = z.unknown().transform((value, context) => {
	const validation = validateExpiryReminderLeadDays(value);
	if (validation.ok) return validation.value;
	context.addIssue({ code: "custom", message: validation.message });
	return z.NEVER;
});

// =============================================================================
// The employee a skill action works on
// =============================================================================

/**
 * Loads `employeeId` in the session's organization (another organization's
 * employee is not found) and refuses one outside the actor's managed scope.
 */
function employeeInScope(actor: OrganizationActor, organizationId: string, employeeId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const target = yield* dbService.query("skills.targetEmployee", () =>
			dbService.db.query.employee.findFirst({
				where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
				columns: { id: true },
			}),
		);
		if (!target) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee not found",
					entityType: "employee",
					entityId: employeeId,
				}),
			);
		}
		const scope = yield* actor.managedScope();
		if (!scope.organizationWide && !scope.employeeIds.has(employeeId)) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "You do not have access to this employee's skills",
					userId: actor.userId,
					resource: "employeeSkill",
					action: "access",
				}),
			);
		}
	});
}

// =============================================================================
// Skill Catalog Actions
// =============================================================================

/** Creates a skill in the organization's catalog. */
export const createSkill = organizationAction(
	{ name: "skills.create", requires: "orgAdmin", schema: createSkillSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			const newSkill = yield* skillService.createSkill({
				...input,
				organizationId,
				createdBy: actor.userId,
			});
			logger.info({ skillId: newSkill.id, organizationId }, "Skill created successfully");
			revalidateTag(CACHE_TAGS.SKILLS(organizationId), "max");
			return newSkill as SkillWithRelations;
		}),
);

/** Updates a skill of the organization's catalog. */
export const updateSkill = organizationAction(
	{ name: "skills.update", requires: "orgAdmin", schema: updateSkillSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			const updatedSkill = yield* skillService.updateSkill(organizationId, input.skillId, {
				...input.data,
				updatedBy: actor.userId,
			});
			logger.info({ skillId: input.skillId }, "Skill updated successfully");
			revalidateTag(CACHE_TAGS.SKILLS(organizationId), "max");
			return updatedSkill as SkillWithRelations;
		}),
);

/** Soft-deletes a skill of the organization's catalog. */
export const deleteSkill = organizationAction(
	{ name: "skills.delete", requires: "orgAdmin", schema: id },
	({ organizationId, input: skillId }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			yield* skillService.deleteSkill(organizationId, skillId);
			logger.info({ skillId }, "Skill deleted successfully");
			revalidateTag(CACHE_TAGS.SKILLS(organizationId), "max");
		}),
);

/** The organization's skill catalog. */
export const getOrganizationSkills = organizationAction(
	{
		name: "skills.listOrganization",
		requires: "scopedManager",
		schema: z.strictObject({ includeInactive: z.boolean().optional() }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			return yield* skillService.getOrganizationSkills(organizationId, input);
		}),
);

// =============================================================================
// Employee Skill Assignment Actions
// =============================================================================

/** Assigns a skill to an employee the actor manages. */
export const assignSkillToEmployee = organizationAction(
	{
		name: "skills.assignToEmployee",
		requires: "scopedManager",
		schema: z.strictObject({
			employeeId: id,
			skillId: id,
			/** Skill expiry date: `YYYY-MM-DD`, the last valid day. Empty never expires. */
			expiresAt: z.string().nullable().optional(),
			notes: z.string().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* employeeInScope(actor, organizationId, input.employeeId);
			const skillService = yield* SkillService;
			const assignment = yield* skillService.assignSkillToEmployee({
				...input,
				organizationId,
				assignedBy: actor.userId,
			});
			const skillDetails = yield* skillService.getSkillById(organizationId, input.skillId);
			logger.info(
				{ employeeId: input.employeeId, skillId: input.skillId },
				"Skill assigned to employee",
			);
			revalidateTag(CACHE_TAGS.EMPLOYEE_SKILLS(input.employeeId), "max");
			return { ...assignment, skill: skillDetails! } as EmployeeSkillWithDetails;
		}),
);

/** Changes an assigned employee skill's expiry date in place. */
export const updateEmployeeSkillExpiry = organizationAction(
	{
		name: "skills.updateEmployeeSkillExpiry",
		requires: "scopedManager",
		schema: z.strictObject({
			employeeId: id,
			skillId: id,
			/** `YYYY-MM-DD`, the last valid day; null never expires. */
			expiresAt: z.string().nullable(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* employeeInScope(actor, organizationId, input.employeeId);
			const skillService = yield* SkillService;
			const updated = yield* skillService.updateEmployeeSkillExpiry({
				organizationId,
				employeeId: input.employeeId,
				skillId: input.skillId,
				expiresAt: input.expiresAt,
			});
			logger.info(
				{ employeeId: input.employeeId, skillId: input.skillId },
				"Employee skill expiry date changed",
			);
			revalidateTag(CACHE_TAGS.EMPLOYEE_SKILLS(input.employeeId), "max");
			return updated;
		}),
);

/** The organization's today and the "Expiring soon" window the skill badges count from. */
export const getSkillExpiryWindow = organizationAction(
	{ name: "skills.expiryWindow", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			return yield* skillService.getSkillExpiryWindow(organizationId);
		}),
);

/**
 * The skill reminder lead time (#1143): days before a skill expiry date at which the employee and
 * their managers are reminded and the "Expiring soon" badge shows. 1–365 days.
 */
export const saveSkillReminderLeadDays = organizationAction(
	{
		name: "skills.saveReminderLeadDays",
		requires: "orgAdmin",
		schema: z.strictObject({ leadDays }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("saveSkillReminderLeadDays", () =>
				saveSkillReminderLeadDaysToStore(dbService.db, {
					organizationId,
					leadDays: input.leadDays,
					actorUserId: actor.userId,
				}),
			);
			logger.info({ organizationId, leadDays: input.leadDays }, "Skill reminder lead time changed");
			revalidatePath("/settings/skills");
			return { leadDays: input.leadDays };
		}),
);

/** Removes a skill from an employee the actor manages. */
export const removeSkillFromEmployee = organizationAction(
	{ name: "skills.removeFromEmployee", requires: "scopedManager", schema: employeeSkillSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* employeeInScope(actor, organizationId, input.employeeId);
			const skillService = yield* SkillService;
			yield* skillService.removeSkillFromEmployee(organizationId, input.employeeId, input.skillId);
			logger.info(
				{ employeeId: input.employeeId, skillId: input.skillId },
				"Skill removed from employee",
			);
			revalidateTag(CACHE_TAGS.EMPLOYEE_SKILLS(input.employeeId), "max");
		}),
);

/** The skills of an employee the actor manages. */
export const getEmployeeSkills = organizationAction(
	{ name: "skills.listEmployee", requires: "scopedManager", schema: id },
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			yield* employeeInScope(actor, organizationId, employeeId);
			const skillService = yield* SkillService;
			return yield* skillService.getEmployeeSkills(organizationId, employeeId);
		}),
);

// =============================================================================
// Skill Requirements Actions (Subareas & Templates)
// =============================================================================

/** Sets the skill requirements of a subarea. */
export const setSubareaSkillRequirements = organizationAction(
	{
		name: "skills.setSubareaRequirements",
		requires: "orgAdmin",
		schema: z.strictObject({ subareaId: id, requirements: skillRequirements }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			yield* skillService.setSubareaSkillRequirements({
				organizationId,
				targetId: input.subareaId,
				requirements: input.requirements,
				createdBy: actor.userId,
			});
			logger.info(
				{ subareaId: input.subareaId, requirementCount: input.requirements.length },
				"Subarea skill requirements updated",
			);
			revalidateTag(CACHE_TAGS.SUBAREA_SKILLS(input.subareaId), "max");
		}),
);

/** Sets the skill requirements of a shift template. */
export const setTemplateSkillRequirements = organizationAction(
	{
		name: "skills.setTemplateRequirements",
		requires: "orgAdmin",
		schema: z.strictObject({ templateId: id, requirements: skillRequirements }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			yield* skillService.setTemplateSkillRequirements({
				organizationId,
				targetId: input.templateId,
				requirements: input.requirements,
				createdBy: actor.userId,
			});
			logger.info(
				{ templateId: input.templateId, requirementCount: input.requirements.length },
				"Template skill requirements updated",
			);
			revalidateTag(CACHE_TAGS.TEMPLATE_SKILLS(input.templateId), "max");
		}),
);

// =============================================================================
// Skill Validation Actions
// =============================================================================

/** The shift date, `YYYY-MM-DD` on the organization's calendar. */
const shiftDate = z.string().min(1);

/** Whether an employee is qualified for a shift, with any missing or expired skills. */
export const validateEmployeeForShift = organizationAction(
	{
		name: "skills.validateEmployeeForShift",
		requires: "member",
		schema: z.strictObject({
			employeeId: id,
			shift: z.strictObject({
				subareaId: id,
				templateId: z.string().nullable().optional(),
				date: shiftDate,
			}),
		}),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			return yield* skillService.validateEmployeeForShift(
				organizationId,
				input.employeeId,
				input.shift,
			);
		}),
);

/** The employees that hold all `skillIds`, none expired on the shift date. */
export const getQualifiedEmployeesForSkills = organizationAction(
	{
		name: "skills.qualifiedEmployees",
		requires: "member",
		schema: z.strictObject({ skillIds: z.array(id), shiftDate }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const skillService = yield* SkillService;
			return yield* skillService.getQualifiedEmployeesForSkills(
				organizationId,
				input.skillIds,
				input.shiftDate,
			);
		}),
);
