"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee } from "@/db/schema";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	SkillService,
	type CreateSkillInput,
	type UpdateSkillInput,
	type AssignSkillInput,
	type SetSkillRequirementsInput,
	type SkillWithRelations,
	type EmployeeSkillWithDetails,
	type SkillValidationResult,
} from "@/lib/effect/services/skill.service";

import { CACHE_TAGS } from "@/lib/cache/tags";
import { createLogger } from "@/lib/logger";

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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const skillService = yield* _(SkillService);

				// Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
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

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can create skills",
								userId: currentEmployee.id,
								resource: "skill",
								action: "create",
							}),
						),
					);
				}

				span.setAttribute("employee.id", currentEmployee.id);

				const newSkill = yield* _(
					skillService.createSkill({
						...data,
						organizationId: currentEmployee.organizationId,
						createdBy: session.user.id,
					}),
				);

				logger.info(
					{
						skillId: newSkill.id,
						name: newSkill.name,
						organizationId: newSkill.organizationId,
					},
					"Skill created successfully",
				);

				revalidateTag(CACHE_TAGS.SKILLS(currentEmployee.organizationId), "max");

				span.setAttribute("skill.id", newSkill.id);
				span.setStatus({ code: SpanStatusCode.OK });
				return newSkill as SkillWithRelations;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error }, "Failed to create skill");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const skillService = yield* _(SkillService);

				// Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
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

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can update skills",
								userId: currentEmployee.id,
								resource: "skill",
								action: "update",
							}),
						),
					);
				}

				const updatedSkill = yield* _(
					skillService.updateSkill(skillId, {
						...data,
						updatedBy: session.user.id,
					}),
				);

				logger.info({ skillId }, "Skill updated successfully");

				revalidateTag(CACHE_TAGS.SKILLS(currentEmployee.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
				return updatedSkill as SkillWithRelations;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, skillId }, "Failed to update skill");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const skillService = yield* _(SkillService);

				// Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
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

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can delete skills",
								userId: currentEmployee.id,
								resource: "skill",
								action: "delete",
							}),
						),
					);
				}

				yield* _(skillService.deleteSkill(skillId));

				logger.info({ skillId }, "Skill deleted successfully");

				revalidateTag(CACHE_TAGS.SKILLS(currentEmployee.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, skillId }, "Failed to delete skill");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const skillService = yield* _(SkillService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		const skills = yield* _(
			skillService.getOrganizationSkills(currentEmployee.organizationId, options),
		);

		return skills;
	}).pipe(Effect.provide(AppLayer));

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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const skillService = yield* _(SkillService);

				// Get current employee and verify role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
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

				if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and managers can assign skills",
								userId: currentEmployee.id,
								resource: "employeeSkill",
								action: "create",
							}),
						),
					);
				}

				const assignment = yield* _(
					skillService.assignSkillToEmployee({
						...data,
						assignedBy: session.user.id,
					}),
				);

				// Get the skill details for the response
				const skillDetails = yield* _(skillService.getSkillById(data.skillId));

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error }, "Failed to assign skill to employee");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const skillService = yield* _(SkillService);

				// Get current employee and verify role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
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

				if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and managers can remove skills",
								userId: currentEmployee.id,
								resource: "employeeSkill",
								action: "delete",
							}),
						),
					);
				}

				yield* _(skillService.removeSkillFromEmployee(employeeId, skillId));

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, employeeId, skillId }, "Failed to remove skill from employee");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const skillService = yield* _(SkillService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		// Get target employee to verify same org
		const targetEmployee = yield* _(
			dbService.query("getTargetEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee not found",
								entityType: "employee",
								entityId: employeeId,
							}),
						),
			),
		);

		if (targetEmployee.organizationId !== currentEmployee.organizationId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot access employee from different organization",
						userId: currentEmployee.id,
						resource: "employeeSkill",
						action: "read",
					}),
				),
			);
		}

		const skills = yield* _(skillService.getEmployeeSkills(employeeId));

		return skills;
	}).pipe(Effect.provide(AppLayer));

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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const skillService = yield* _(SkillService);

				// Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
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

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can set subarea skill requirements",
								userId: currentEmployee.id,
								resource: "subareaSkillRequirement",
								action: "update",
							}),
						),
					);
				}

				yield* _(
					skillService.setSubareaSkillRequirements({
						targetId: subareaId,
						requirements,
						createdBy: session.user.id,
					}),
				);

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, subareaId }, "Failed to set subarea skill requirements");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const skillService = yield* _(SkillService);

				// Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
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

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can set template skill requirements",
								userId: currentEmployee.id,
								resource: "templateSkillRequirement",
								action: "update",
							}),
						),
					);
				}

				yield* _(
					skillService.setTemplateSkillRequirements({
						targetId: templateId,
						requirements,
						createdBy: session.user.id,
					}),
				);

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, templateId }, "Failed to set template skill requirements");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());
		const skillService = yield* _(SkillService);

		const result = yield* _(skillService.validateEmployeeForShift(employeeId, shiftData));

		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get qualified employees for a set of required skills
 * Returns employee IDs that have all required skills
 */
export async function getQualifiedEmployeesForSkills(
	skillIds: string[],
): Promise<ServerActionResult<string[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const skillService = yield* _(SkillService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		const qualifiedEmployeeIds = yield* _(
			skillService.getQualifiedEmployeesForSkills(currentEmployee.organizationId, skillIds),
		);

		return qualifiedEmployeeIds;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
