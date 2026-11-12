"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { project } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { systemClock } from "@/lib/datetime/temporal-core";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import {
	keepCustomFieldRefusal,
	saveFormCustomFieldValues,
} from "@/lib/organization/custom-fields/form-values";
import type { CustomFieldValuesInput } from "@/lib/organization/custom-fields/value-rules";
import { isProjectNameConflict } from "@/lib/projects/project-creation";
import {
	createProjectFromTemplateRows,
	projectAsTemplateInput,
	type SkippedManagerOrAssignment,
} from "@/lib/projects/project-from-template";
import {
	normalizeProjectTemplateInput,
	type ProjectTemplatePreviewData,
} from "@/lib/projects/project-template-model";
import {
	getProjectTemplate,
	listProjectTemplates,
	writeProjectTemplate,
} from "@/lib/projects/project-templates";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction";
import {
	projectBillableDefault,
	requireBillableTimeForDefaultChange,
} from "./project-billable-default-input";
import {
	ensureSettingsActorCanUseProjectCustomer,
	type ProjectSettingsActor,
} from "./project-scope";
import {
	auditTemplate,
	keepTypedTemplateError,
	templateInputProblem,
	templateNotFound,
} from "./project-template-access";

/**
 * Project templates in use (#880): creating a project from a template, and
 * saving a project as a template. Every action runs in the session's active
 * organization. Whoever may create projects (settings access `scopedManager`)
 * may create one from a template and so read the templates; saving a project as
 * a template is for org owners and admins, like managing templates.
 */

const DUPLICATE_PROJECT_NAME = "A project with this name already exists";

const templateId = z.string().min(1, "Template is required");

const createProjectFromTemplateSchema = z.strictObject({
	templateId,
	name: z.string({ error: "Project name is required" }),
	description: z.string().nullable().optional(),
	status: z.enum(["planned", "active", "paused", "completed", "archived"]).optional(),
	customerId: z.string().nullable().optional(),
	/** Billable default (#900); only a project with a customer can have it on. */
	billableDefault: z.boolean({ error: "Invalid billable default" }).optional(),
	/** The dialog's custom field values (#818); `saveFormCustomFieldValues` checks each. */
	customFieldValues: z
		.record(z.string(), z.unknown())
		.optional()
		.transform((values) => values as CustomFieldValuesInput | undefined),
});

export type CreateProjectFromTemplateInput = z.input<typeof createProjectFromTemplateSchema>;

function keepTypedCreationError(error: DatabaseError) {
	return isProjectNameConflict(error.cause)
		? new ValidationError({ message: DUPLICATE_PROJECT_NAME, field: "name" })
		: error;
}

/** The actor as the project settings scope helpers (`./project-scope`) read them. */
function projectSettingsActorOf(
	actor: OrganizationActor,
	organizationId: string,
	dbService: typeof DatabaseService.Service,
): ProjectSettingsActor {
	return {
		session: { user: { id: actor.userId }, session: { activeOrganizationId: organizationId } },
		dbService,
		organizationId,
		accessTier: meetsSettingsAccess(actor.settingsAccess, "orgAdmin") ? "orgAdmin" : "manager",
		currentEmployee: actor.employee as ProjectSettingsActor["currentEmployee"],
	};
}

/**
 * The organization's templates, for anyone who may create projects. Managing
 * them stays with org owners and admins (`./template-actions`).
 */
export const getProjectTemplateChoices = organizationAction(
	{ name: "projectTemplate.choices", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("projectTemplate.choices", () =>
				listProjectTemplates({ organizationId }),
			);
		}),
);

/**
 * One template with what creating a project from it would copy, including
 * which managers and assignments are no longer available. `managersCopied` is
 * false for a creator who is not an org owner or admin: only they assign
 * project managers (#367), so the template's managers are left out.
 */
export const getProjectTemplatePreview = organizationAction(
	{ name: "projectTemplate.preview", requires: "scopedManager", schema: templateId },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const template = yield* dbService.query("projectTemplate.preview", () =>
				getProjectTemplate({ organizationId, templateId: input }),
			);
			if (!template) return yield* Effect.fail(templateNotFound(input));
			return {
				...template,
				managersCopied: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
			} satisfies ProjectTemplatePreviewData;
		}),
);

/**
 * Creates a project from a template, copying it once. Managers and
 * assignments whose employee has left or whose team or employee no longer
 * exists are skipped and returned in `skipped`; the project is still created.
 */
export const createProjectFromTemplate = organizationAction(
	{
		name: "project.createFromTemplate",
		requires: "scopedManager",
		schema: createProjectFromTemplateSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const userId = actor.userId;
			const isOrgAdmin = meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
			const name = input.name.trim();
			if (name.length === 0) {
				return yield* Effect.fail(
					new ValidationError({ message: "Project name is required", field: "name" }),
				);
			}

			const duplicate = yield* dbService.query("project.createFromTemplate:name", () =>
				dbService.db.query.project.findFirst({
					where: and(eq(project.organizationId, organizationId), eq(project.name, name)),
					columns: { id: true },
				}),
			);
			if (duplicate) {
				return yield* Effect.fail(
					new ValidationError({ message: DUPLICATE_PROJECT_NAME, field: "name" }),
				);
			}

			const customerId = input.customerId || null;
			if (customerId) {
				yield* ensureSettingsActorCanUseProjectCustomer(
					projectSettingsActorOf(actor, organizationId, dbService),
					customerId,
					"create",
				);
			}

			// The same billable default rules as a hand-made project (#900).
			yield* requireBillableTimeForDefaultChange(dbService, organizationId, {
				requested: input.billableDefault,
				current: false,
			});
			const billableDefault = yield* projectBillableDefault({
				requested: input.billableDefault,
				current: false,
				customerId,
			});

			const status = input.status ?? "planned";
			// Assignments change what is bookable, so the copy serializes with
			// booking preparation like any assignment change (#315).
			const created = yield* dbService
				.query("project.createFromTemplate", () =>
					withOrganizationConfigurationMutation(dbService.db, organizationId, async (tx) => {
						const copied = await createProjectFromTemplateRows(
							tx,
							{
								organizationId,
								userId,
								templateId: input.templateId,
								now: systemClock.nowInstant(),
								// A scoped manager manages the project they create.
								alsoManagedBy: isOrgAdmin ? null : (actor.employee?.id ?? null),
								assignsManagers: isOrgAdmin,
							},
							{
								name,
								description: input.description?.trim() || null,
								status,
								customerId,
								billableDefault,
							},
						);
						if (copied) {
							await saveFormCustomFieldValues(tx, {
								organizationId,
								actorUserId: userId,
								entity: "project",
								recordId: copied.id,
								values: input.customFieldValues,
							});
						}
						return copied;
					}),
				)
				.pipe(Effect.mapError(keepTypedCreationError), keepCustomFieldRefusal);
			if (!created) return yield* Effect.fail(templateNotFound(input.templateId));

			logAudit({
				action: AuditAction.PROJECT_CREATED,
				actorId: userId,
				targetId: created.id,
				targetType: "project",
				organizationId,
				changes: { name, status },
				metadata: {
					projectName: name,
					fromTemplateId: created.template.id,
					fromTemplateName: created.template.name,
					skippedMembers: created.skipped,
				},
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/projects");
			return { id: created.id, skipped: created.skipped };
		}),
);

/**
 * Saves a project as a new template (org owners and admins only): its icon,
 * colour, budget, open tasks, managers and assignments, without a deadline
 * offset. Managers and assigned employees who have left the organization are
 * skipped and returned in `skipped`. The template is named after the project
 * unless `name` is given.
 */
export const saveProjectAsTemplate = organizationAction(
	{
		name: "projectTemplate.saveFromProject",
		requires: "orgAdmin",
		schema: z.strictObject({
			projectId: z.string().min(1, "Project is required"),
			name: z.string().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			// One transaction reads the project and writes the template, so someone
			// leaving in between is skipped and reported, never refusing the save.
			const saved = yield* dbService
				.query("projectTemplate.saveFromProject", () =>
					dbService.db.transaction(async (tx) => {
						const source = await projectAsTemplateInput(tx, {
							organizationId,
							projectId: input.projectId,
						});
						if (!source) return null;
						const normalized = normalizeProjectTemplateInput({
							...source.input,
							name: input.name ?? source.project.name,
						});
						if (!normalized.ok) throw templateInputProblem(normalized.problem);
						const values = normalized.value;
						const written = await writeProjectTemplate(
							tx,
							{ organizationId, userId: actor.userId },
							values,
							{ skipDeparted: true },
						);
						const managerIds = new Set(values.managerEmployeeIds);
						const employeeIds = new Set(values.employeeIds);
						const leftMeanwhile = written.departed.flatMap(
							({ employeeId, name }): SkippedManagerOrAssignment[] => [
								...(managerIds.has(employeeId)
									? [{ role: "manager" as const, name, reason: "departed" as const }]
									: []),
								...(employeeIds.has(employeeId)
									? [{ role: "employee" as const, name, reason: "departed" as const }]
									: []),
							],
						);
						return {
							id: written.id,
							values,
							projectId: source.project.id,
							skipped: [...source.skipped, ...leftMeanwhile],
						};
					}),
				)
				.pipe(Effect.mapError(keepTypedTemplateError));
			if (!saved) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Project not found",
						entityType: "project",
						entityId: input.projectId,
					}),
				);
			}

			auditTemplate(
				{ userId: actor.userId, organizationId },
				AuditAction.PROJECT_TEMPLATE_CREATED,
				{ id: saved.id, name: saved.values.name },
				{ name: saved.values.name, taskNames: saved.values.tasks.map((task) => task.name) },
				{ fromProjectId: saved.projectId, skippedMembers: saved.skipped },
			);

			revalidatePath("/settings/projects");
			return { id: saved.id, name: saved.values.name, skipped: saved.skipped };
		}),
);
