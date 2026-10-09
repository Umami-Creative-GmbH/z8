"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { employee } from "@/db/schema";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { type AnyAppError, AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type AssignSkillInput,
	type CreateSkillInput,
	type EmployeeSkillWithDetails,
	SkillService,
	type SkillValidationResult,
	type SkillWithRelations,
	type UpdateSkillInput,
} from "@/lib/effect/services/skill.service";
import { createLogger } from "@/lib/logger";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
	getTargetEmployee,
	requireOrgAdminEmployeeSettingsAccess,
} from "../employees/employee-action-utils";

const logger = createLogger("SkillActions");

// =============================================================================
// Skill Catalog Actions
// =============================================================================

/**
 * Create a new skill in the organization's catalog
 * Requires admin role
 */
export async function createSkill(
	data: Omit<CreateSkillInput, "organizationId" | "createdBy">,
): Promise<ServerActionResult<SkillWithRelations>> {
	const tracer = trace.getTracer("skills");

	const effect = tracer.startActiveSpan(
		"createSkill",
		{
			attributes: {
				"skill.name": data.name,
				"skill.category": data.category,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "createSkill:actor" });
				const { session } = actor;
				const skillService = yield* SkillService;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can create skills",
					resource: "skill",
					action: "create",
				});

				if (actor.currentEmployee) {
					span.setAttribute("employee.id", actor.currentEmployee.id);
				}

				const newSkill = yield* skillService.createSkill({
					...data,
					organizationId: actor.organizationId,
					createdBy: session.user.id,
				});

				logger.info(
					{
						skillId: newSkill.id,
						name: newSkill.name,
						organizationId: newSkill.organizationId,
					},
					"Skill created successfully",
				);

				revalidateTag(CACHE_TAGS.SKILLS(actor.organizationId), "max");

				span.setAttribute("skill.id", newSkill.id);
				span.setStatus({ code: SpanStatusCode.OK });
				return newSkill as SkillWithRelations;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error }, "Failed to create skill");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Update an existing skill
 * Requires admin role
 */
export async function updateSkill(
	skillId: string,
	data: Omit<UpdateSkillInput, "updatedBy">,
): Promise<ServerActionResult<SkillWithRelations>> {
	const tracer = trace.getTracer("skills");

	const effect = tracer.startActiveSpan(
		"updateSkill",
		{
			attributes: {
				"skill.id": skillId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "updateSkill:actor" });
				const { session } = actor;
				const skillService = yield* SkillService;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can update skills",
					resource: "skill",
					action: "update",
				});

				const updatedSkill = yield* skillService.updateSkill(skillId, {
					...data,
					updatedBy: session.user.id,
				});

				logger.info({ skillId }, "Skill updated successfully");

				revalidateTag(CACHE_TAGS.SKILLS(actor.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
				return updatedSkill as SkillWithRelations;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, skillId }, "Failed to update skill");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Delete (soft-delete) a skill
 * Requires admin role
 */
export async function deleteSkill(skillId: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("skills");

	const effect = tracer.startActiveSpan(
		"deleteSkill",
		{
			attributes: {
				"skill.id": skillId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "deleteSkill:actor" });
				const skillService = yield* SkillService;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can delete skills",
					resource: "skill",
					action: "delete",
				});

				yield* skillService.deleteSkill(skillId);

				logger.info({ skillId }, "Skill deleted successfully");

				revalidateTag(CACHE_TAGS.SKILLS(actor.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, skillId }, "Failed to delete skill");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get all skills for the organization
 */
export async function getOrganizationSkills(options?: {
	includeInactive?: boolean;
}): Promise<ServerActionResult<SkillWithRelations[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "getOrganizationSkills:actor" });
		const skillService = yield* SkillService;

		const skills = yield* skillService.getOrganizationSkills(actor.organizationId, options);

		return skills;
	});

	return runServerActionSafe(effect);
}

// =============================================================================
// Employee Skill Assignment Actions
// =============================================================================

/**
 * Assign a skill to an employee
 * Requires admin or manager role
 */
export async function assignSkillToEmployee(
	data: Omit<AssignSkillInput, "assignedBy">,
): Promise<ServerActionResult<EmployeeSkillWithDetails>> {
	const tracer = trace.getTracer("skills");

	const effect = tracer.startActiveSpan(
		"assignSkillToEmployee",
		{
			attributes: {
				"employee.id": data.employeeId,
				"skill.id": data.skillId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "assignSkillToEmployee:actor" });
				const { session } = actor;
				const skillService = yield* SkillService;

				if (actor.accessTier !== "orgAdmin" && actor.accessTier !== "manager") {
					yield* Effect.fail(
						new AuthorizationError({
							message: "Only admins and managers can assign skills",
							userId: session.user.id,
							resource: "employeeSkill",
							action: "create",
						}),
					);
				}

				const targetEmployee = yield* getTargetEmployee(data.employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's skills",
					resource: "employeeSkill",
					action: "create",
				});

				const assignment = yield* skillService.assignSkillToEmployee({
					...data,
					assignedBy: session.user.id,
				});

				// Get the skill details for the response
				const skillDetails = yield* skillService.getSkillById(data.skillId);

				logger.info(
					{
						employeeId: data.employeeId,
						skillId: data.skillId,
					},
					"Skill assigned to employee",
				);

				revalidateTag(CACHE_TAGS.EMPLOYEE_SKILLS(data.employeeId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
				return {
					...assignment,
					skill: skillDetails!,
				} as EmployeeSkillWithDetails;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error }, "Failed to assign skill to employee");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Remove a skill from an employee
 * Requires admin or manager role
 */
export async function removeSkillFromEmployee(
	employeeId: string,
	skillId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("skills");

	const effect = tracer.startActiveSpan(
		"removeSkillFromEmployee",
		{
			attributes: {
				"employee.id": employeeId,
				"skill.id": skillId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "removeSkillFromEmployee:actor" });
				const skillService = yield* SkillService;

				if (actor.accessTier !== "orgAdmin" && actor.accessTier !== "manager") {
					yield* Effect.fail(
						new AuthorizationError({
							message: "Only admins and managers can remove skills",
							userId: actor.session.user.id,
							resource: "employeeSkill",
							action: "delete",
						}),
					);
				}

				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's skills",
					resource: "employeeSkill",
					action: "delete",
				});

				yield* skillService.removeSkillFromEmployee(employeeId, skillId);

				logger.info(
					{
						employeeId,
						skillId,
					},
					"Skill removed from employee",
				);

				revalidateTag(CACHE_TAGS.EMPLOYEE_SKILLS(employeeId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, employeeId, skillId }, "Failed to remove skill from employee");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get all skills for an employee
 */
export async function getEmployeeSkills(
	employeeId: string,
): Promise<ServerActionResult<EmployeeSkillWithDetails[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "getEmployeeSkills:actor" });
		const skillService = yield* SkillService;

		const targetEmployee = yield* getTargetEmployee(employeeId);

		yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
			message: "You do not have access to this employee's skills",
			resource: "employeeSkill",
			action: "read",
		});

		const skills = yield* skillService.getEmployeeSkills(employeeId);

		return skills;
	});

	return runServerActionSafe(effect);
}

// =============================================================================
// Skill Requirements Actions (Subareas & Templates)
// =============================================================================

/**
 * Set skill requirements for a subarea
 * Requires admin role
 */
export async function setSubareaSkillRequirements(
	subareaId: string,
	requirements: Array<{ skillId: string; isRequired: boolean }>,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("skills");

	const effect = tracer.startActiveSpan(
		"setSubareaSkillRequirements",
		{
			attributes: {
				"subarea.id": subareaId,
				"requirements.count": requirements.length,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "setSubareaSkillRequirements:actor" });
				const { session } = actor;
				const skillService = yield* SkillService;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can set subarea skill requirements",
					resource: "subareaSkillRequirement",
					action: "update",
				});

				yield* skillService.setSubareaSkillRequirements({
					targetId: subareaId,
					requirements,
					createdBy: session.user.id,
				});

				logger.info(
					{
						subareaId,
						requirementCount: requirements.length,
					},
					"Subarea skill requirements updated",
				);

				revalidateTag(CACHE_TAGS.SUBAREA_SKILLS(subareaId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, subareaId }, "Failed to set subarea skill requirements");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Set skill requirements for a shift template
 * Requires admin role
 */
export async function setTemplateSkillRequirements(
	templateId: string,
	requirements: Array<{ skillId: string; isRequired: boolean }>,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("skills");

	const effect = tracer.startActiveSpan(
		"setTemplateSkillRequirements",
		{
			attributes: {
				"template.id": templateId,
				"requirements.count": requirements.length,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "setTemplateSkillRequirements:actor" });
				const { session } = actor;
				const skillService = yield* SkillService;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can set template skill requirements",
					resource: "templateSkillRequirement",
					action: "update",
				});

				yield* skillService.setTemplateSkillRequirements({
					targetId: templateId,
					requirements,
					createdBy: session.user.id,
				});

				logger.info(
					{
						templateId,
						requirementCount: requirements.length,
					},
					"Template skill requirements updated",
				);

				revalidateTag(CACHE_TAGS.TEMPLATE_SKILLS(templateId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, templateId }, "Failed to set template skill requirements");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

// =============================================================================
// Skill Validation Actions
// =============================================================================

/**
 * Validate if an employee is qualified for a shift
 * Returns qualification status and any missing/expired skills
 */
export async function validateEmployeeForShift(
	employeeId: string,
	shiftData: {
		subareaId: string;
		templateId?: string | null;
	},
): Promise<ServerActionResult<SkillValidationResult>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		yield* authService.getSession();
		const skillService = yield* SkillService;

		const result = yield* skillService.validateEmployeeForShift(employeeId, shiftData);

		return result;
	});

	return runServerActionSafe(effect);
}

/**
 * Get qualified employees for a set of required skills
 * Returns employee IDs that have all required skills
 */
export async function getQualifiedEmployeesForSkills(
	skillIds: string[],
): Promise<ServerActionResult<string[]>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		const skillService = yield* SkillService;

		// Get current employee
		const currentEmployee = yield* dbService
			.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			})
			.pipe(
				Effect.flatMap((emp) =>
					emp
						? Effect.succeed(emp)
						: Effect.fail(
								new NotFoundError({
									message: "Employee profile not found",
									entityType: "employee",
								}),
							),
				),
			);

		const qualifiedEmployeeIds = yield* skillService.getQualifiedEmployeesForSkills(
			currentEmployee.organizationId,
			skillIds,
		);

		return qualifiedEmployeeIds;
	});

	return runServerActionSafe(effect);
}
