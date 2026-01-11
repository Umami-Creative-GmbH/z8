"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { workScheduleTemplate, workScheduleTemplateDays } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type CreateWorkScheduleTemplate,
	createWorkScheduleTemplateSchema,
	type UpdateWorkScheduleTemplate,
} from "@/lib/validations/work-schedule";

// Types for return values
export type WorkScheduleTemplateWithDays = typeof workScheduleTemplate.$inferSelect & {
	days: (typeof workScheduleTemplateDays.$inferSelect)[];
};

/**
 * Check if user is org admin or owner
 */
async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
	});

	return membership?.role === "admin" || membership?.role === "owner";
}

/**
 * Get all work schedule templates for an organization
 */
export async function getWorkScheduleTemplates(
	organizationId: string,
): Promise<ServerActionResult<WorkScheduleTemplateWithDays[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_template",
						action: "read",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		const templates = yield* _(
			dbService.query("getWorkScheduleTemplates", async () => {
				return await dbService.db.query.workScheduleTemplate.findMany({
					where: and(
						eq(workScheduleTemplate.organizationId, organizationId),
						eq(workScheduleTemplate.isActive, true),
					),
					with: {
						days: true,
					},
					orderBy: (template, { asc }) => [asc(template.name)],
				});
			}),
		);

		return templates;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get a single work schedule template by ID
 */
export async function getWorkScheduleTemplate(
	templateId: string,
): Promise<ServerActionResult<WorkScheduleTemplateWithDays | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const template = yield* _(
			dbService.query("getWorkScheduleTemplate", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, templateId),
					with: {
						days: true,
					},
				});
			}),
		);

		if (!template) {
			return null;
		}

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, template.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_template",
						action: "read",
					}),
				),
			);
		}

		return template;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Create a new work schedule template
 */
export async function createWorkScheduleTemplate(
	organizationId: string,
	data: CreateWorkScheduleTemplate,
): Promise<ServerActionResult<WorkScheduleTemplateWithDays>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_template",
						action: "create",
					}),
				),
			);
		}

		// Validate input
		const validationResult = createWorkScheduleTemplateSchema.safeParse(data);
		if (!validationResult.success) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: validationResult.error.errors[0]?.message || "Validation failed",
						entityType: "work_schedule_template",
						conflictField: "validation",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);

		// Check for duplicate name
		const existingTemplate = yield* _(
			dbService.query("checkDuplicateName", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: and(
						eq(workScheduleTemplate.organizationId, organizationId),
						eq(workScheduleTemplate.name, data.name),
						eq(workScheduleTemplate.isActive, true),
					),
				});
			}),
		);

		if (existingTemplate) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "A template with this name already exists",
						entityType: "work_schedule_template",
						conflictField: "name",
					}),
				),
			);
		}

		// Create template
		const [newTemplate] = yield* _(
			dbService.query("createTemplate", async () => {
				return await dbService.db
					.insert(workScheduleTemplate)
					.values({
						organizationId,
						name: data.name,
						description: data.description,
						scheduleCycle: data.scheduleCycle,
						scheduleType: data.scheduleType,
						workingDaysPreset: data.scheduleType === "detailed" ? "custom" : data.workingDaysPreset,
						hoursPerCycle: data.scheduleType === "simple" ? data.hoursPerCycle : null,
						homeOfficeDaysPerCycle: data.homeOfficeDaysPerCycle ?? 0,
						createdBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.returning();
			}),
		);

		// If detailed, create day entries
		if (data.scheduleType === "detailed" && data.days) {
			yield* _(
				dbService.query("createDays", async () => {
					await dbService.db.insert(workScheduleTemplateDays).values(
						data.days.map((day) => ({
							templateId: newTemplate.id,
							dayOfWeek: day.dayOfWeek,
							hoursPerDay: day.hoursPerDay,
							isWorkDay: day.isWorkDay,
							cycleWeek: day.cycleWeek ?? 1,
						})),
					);
				}),
			);
		}

		// Fetch complete template with days
		const completeTemplate = yield* _(
			dbService.query("fetchComplete", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, newTemplate.id),
					with: {
						days: true,
					},
				});
			}),
		);

		if (!completeTemplate) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Failed to fetch created template",
						entityType: "work_schedule_template",
					}),
				),
			);
		}

		return completeTemplate;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update a work schedule template
 */
export async function updateWorkScheduleTemplate(
	templateId: string,
	data: UpdateWorkScheduleTemplate,
): Promise<ServerActionResult<WorkScheduleTemplateWithDays>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get existing template
		const existingTemplate = yield* _(
			dbService.query("getExisting", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, templateId),
				});
			}),
		);

		if (!existingTemplate) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Template not found",
						entityType: "work_schedule_template",
						entityId: templateId,
					}),
				),
			);
		}

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, existingTemplate.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_template",
						action: "update",
					}),
				),
			);
		}

		// Check for duplicate name if name is being changed
		if (data.name && data.name !== existingTemplate.name) {
			const duplicateTemplate = yield* _(
				dbService.query("checkDuplicate", async () => {
					return await dbService.db.query.workScheduleTemplate.findFirst({
						where: and(
							eq(workScheduleTemplate.organizationId, existingTemplate.organizationId),
							eq(workScheduleTemplate.name, data.name!),
							eq(workScheduleTemplate.isActive, true),
						),
					});
				}),
			);

			if (duplicateTemplate && duplicateTemplate.id !== templateId) {
				yield* _(
					Effect.fail(
						new ConflictError({
							message: "A template with this name already exists",
							entityType: "work_schedule_template",
							conflictField: "name",
						}),
					),
				);
			}
		}

		// Update template
		yield* _(
			dbService.query("updateTemplate", async () => {
				await dbService.db
					.update(workScheduleTemplate)
					.set({
						...data,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workScheduleTemplate.id, templateId));
			}),
		);

		// If days are provided, update them
		if (data.days) {
			// Delete existing days
			yield* _(
				dbService.query("deleteDays", async () => {
					await dbService.db
						.delete(workScheduleTemplateDays)
						.where(eq(workScheduleTemplateDays.templateId, templateId));
				}),
			);

			// Insert new days
			yield* _(
				dbService.query("insertDays", async () => {
					await dbService.db.insert(workScheduleTemplateDays).values(
						data.days?.map((day) => ({
							templateId,
							dayOfWeek: day.dayOfWeek,
							hoursPerDay: day.hoursPerDay,
							isWorkDay: day.isWorkDay,
							cycleWeek: day.cycleWeek ?? 1,
						})),
					);
				}),
			);
		}

		// Fetch updated template
		const updatedTemplate = yield* _(
			dbService.query("fetchUpdated", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, templateId),
					with: {
						days: true,
					},
				});
			}),
		);

		if (!updatedTemplate) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Failed to fetch updated template",
						entityType: "work_schedule_template",
					}),
				),
			);
		}

		return updatedTemplate;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete (soft delete) a work schedule template
 */
export async function deleteWorkScheduleTemplate(
	templateId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get existing template
		const existingTemplate = yield* _(
			dbService.query("getExisting", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, templateId),
				});
			}),
		);

		if (!existingTemplate) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Template not found",
						entityType: "work_schedule_template",
						entityId: templateId,
					}),
				),
			);
		}

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, existingTemplate.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_template",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("softDelete", async () => {
				await dbService.db
					.update(workScheduleTemplate)
					.set({
						isActive: false,
						isDefault: false,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workScheduleTemplate.id, templateId));
			}),
		);

		return undefined;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Set a template as the organization default
 */
export async function setDefaultTemplate(templateId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get template
		const template = yield* _(
			dbService.query("getTemplate", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, templateId),
				});
			}),
		);

		if (!template) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Template not found",
						entityType: "work_schedule_template",
						entityId: templateId,
					}),
				),
			);
		}

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, template.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_template",
						action: "update",
					}),
				),
			);
		}

		// Unset current default
		yield* _(
			dbService.query("unsetDefault", async () => {
				await dbService.db
					.update(workScheduleTemplate)
					.set({
						isDefault: false,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(
						and(
							eq(workScheduleTemplate.organizationId, template.organizationId),
							eq(workScheduleTemplate.isDefault, true),
						),
					);
			}),
		);

		// Set new default
		yield* _(
			dbService.query("setDefault", async () => {
				await dbService.db
					.update(workScheduleTemplate)
					.set({
						isDefault: true,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workScheduleTemplate.id, templateId));
			}),
		);

		return undefined;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Duplicate a work schedule template
 * Creates a copy with " (Copy)" appended to the name
 */
export async function duplicateWorkScheduleTemplate(
	templateId: string,
): Promise<ServerActionResult<WorkScheduleTemplateWithDays>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get existing template with days
		const existingTemplate = yield* _(
			dbService.query("getExisting", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, templateId),
					with: {
						days: true,
					},
				});
			}),
		);

		if (!existingTemplate) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Template not found",
						entityType: "work_schedule_template",
						entityId: templateId,
					}),
				),
			);
		}

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, existingTemplate.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_template",
						action: "create",
					}),
				),
			);
		}

		// Generate unique name with " (Copy)" suffix
		let newName = `${existingTemplate.name} (Copy)`;
		let copyNumber = 1;

		// Check if name exists and find a unique one
		let nameExists = true;
		while (nameExists) {
			const duplicate = yield* _(
				dbService.query("checkDuplicate", async () => {
					return await dbService.db.query.workScheduleTemplate.findFirst({
						where: and(
							eq(workScheduleTemplate.organizationId, existingTemplate.organizationId),
							eq(workScheduleTemplate.name, newName),
							eq(workScheduleTemplate.isActive, true),
						),
					});
				}),
			);

			if (duplicate) {
				copyNumber++;
				newName = `${existingTemplate.name} (Copy ${copyNumber})`;
			} else {
				nameExists = false;
			}
		}

		// Create duplicate template
		const [newTemplate] = yield* _(
			dbService.query("createDuplicate", async () => {
				return await dbService.db
					.insert(workScheduleTemplate)
					.values({
						organizationId: existingTemplate.organizationId,
						name: newName,
						description: existingTemplate.description,
						scheduleCycle: existingTemplate.scheduleCycle,
						scheduleType: existingTemplate.scheduleType,
						workingDaysPreset: existingTemplate.workingDaysPreset,
						hoursPerCycle: existingTemplate.hoursPerCycle,
						homeOfficeDaysPerCycle: existingTemplate.homeOfficeDaysPerCycle,
						isDefault: false, // Never copy default status
						createdBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.returning();
			}),
		);

		// Duplicate days if the template has them
		if (existingTemplate.days.length > 0) {
			yield* _(
				dbService.query("duplicateDays", async () => {
					await dbService.db.insert(workScheduleTemplateDays).values(
						existingTemplate.days.map((day) => ({
							templateId: newTemplate.id,
							dayOfWeek: day.dayOfWeek,
							hoursPerDay: day.hoursPerDay,
							isWorkDay: day.isWorkDay,
							cycleWeek: day.cycleWeek,
						})),
					);
				}),
			);
		}

		// Fetch complete template with days
		const completeTemplate = yield* _(
			dbService.query("fetchComplete", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: eq(workScheduleTemplate.id, newTemplate.id),
					with: {
						days: true,
					},
				});
			}),
		);

		if (!completeTemplate) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Failed to fetch duplicated template",
						entityType: "work_schedule_template",
					}),
				),
			);
		}

		return completeTemplate;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
