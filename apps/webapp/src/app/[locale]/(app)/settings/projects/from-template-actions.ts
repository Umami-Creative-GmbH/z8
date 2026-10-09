"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { project } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { systemClock } from "@/lib/datetime/temporal-core";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { isProjectNameConflict, type NewProjectStatus } from "@/lib/projects/project-creation";
import {
	createProjectFromTemplateRows,
	projectAsTemplateInput,
	type SkippedProjectMember,
} from "@/lib/projects/project-from-template";
import type {
	ProjectTemplate,
	ProjectTemplateSummary,
} from "@/lib/projects/project-template-model";
import {
	getProjectTemplate,
	listProjectTemplates,
	writeProjectTemplate,
} from "@/lib/projects/project-templates";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction";
import {
	ensureSettingsActorCanUseProjectCustomer,
	getProjectSettingsActorContext,
} from "./project-scope";
import {
	getTemplateAdmin,
	keepTypedTemplateError,
	normalizedTemplateInput,
	templateNotFound,
} from "./project-template-access";
import { tracedProjectAction } from "./traced-project-action";

/**
 * Project templates in use (#880): creating a project from a template, and
 * saving a project as a template. Every action runs in the caller's active
 * organization. Whoever may create projects may create one from a template
 * (and so read the templates); saving a project as a template is for org
 * owners and admins, like managing templates.
 */

const DUPLICATE_PROJECT_NAME = "A project with this name already exists";

export interface CreateProjectFromTemplateInput {
	templateId: string;
	name: string;
	description?: string | null;
	status?: NewProjectStatus;
	customerId?: string | null;
}

function keepTypedCreationError(error: DatabaseError) {
	return isProjectNameConflict(error.cause)
		? new ValidationError({ message: DUPLICATE_PROJECT_NAME, field: "name" })
		: error;
}

/**
 * The organization's templates, for anyone who may create projects. Managing
 * them stays with org owners and admins (`./template-actions`).
 */
export async function getProjectTemplateChoices(): Promise<
	ServerActionResult<ProjectTemplateSummary[]>
> {
	return runServerActionSafe(
		tracedProjectAction(
			"getProjectTemplateChoices",
			{},
			Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					queryName: "getProjectTemplateChoices:actor",
				});
				return yield* actor.dbService.query("listProjectTemplates", () =>
					listProjectTemplates({ organizationId: actor.organizationId }),
				);
			}),
		),
	);
}

/**
 * One template with what creating a project from it would copy, including
 * which managers and assignments are no longer available.
 */
export async function getProjectTemplatePreview(
	templateId: string,
): Promise<ServerActionResult<ProjectTemplate>> {
	return runServerActionSafe(
		tracedProjectAction(
			"getProjectTemplatePreview",
			{ "template.id": templateId },
			Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					queryName: "getProjectTemplatePreview:actor",
				});
				const template = yield* actor.dbService.query("getProjectTemplate", () =>
					getProjectTemplate({ organizationId: actor.organizationId, templateId }),
				);
				if (!template) return yield* Effect.fail(templateNotFound(templateId));
				return template;
			}),
		),
	);
}

/**
 * Creates a project from a template, copying it once. Managers and
 * assignments whose employee has left or whose team or employee no longer
 * exists are skipped and returned in `skipped`; the project is still created.
 */
export async function createProjectFromTemplate(
	input: CreateProjectFromTemplateInput,
): Promise<ServerActionResult<{ id: string; skipped: SkippedProjectMember[] }>> {
	return runServerActionSafe(
		tracedProjectAction(
			"createProjectFromTemplate",
			{ "template.id": input.templateId },
			Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					queryName: "createProjectFromTemplate:actor",
				});
				const userId = actor.session.user.id;
				const name = input.name.trim();
				if (name.length === 0) {
					return yield* Effect.fail(
						new ValidationError({ message: "Project name is required", field: "name" }),
					);
				}

				const duplicate = yield* actor.dbService.query("createProjectFromTemplate:name", () =>
					db.query.project.findFirst({
						where: and(eq(project.organizationId, actor.organizationId), eq(project.name, name)),
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
					yield* ensureSettingsActorCanUseProjectCustomer(actor, customerId, "create");
				}

				const status = input.status ?? "planned";
				// Assignments change what is bookable, so the copy serializes with
				// booking preparation like any assignment change (#315).
				const created = yield* actor.dbService
					.query("project.createFromTemplate", () =>
						withOrganizationConfigurationMutation(db, actor.organizationId, (tx) =>
							createProjectFromTemplateRows(
								tx,
								{
									organizationId: actor.organizationId,
									userId,
									templateId: input.templateId,
									now: systemClock.nowInstant(),
									alsoManagedBy:
										actor.accessTier === "manager" ? (actor.currentEmployee?.id ?? null) : null,
								},
								{
									name,
									description: input.description?.trim() || null,
									status,
									customerId,
								},
							),
						),
					)
					.pipe(Effect.mapError(keepTypedCreationError));
				if (!created) return yield* Effect.fail(templateNotFound(input.templateId));

				logAudit({
					action: AuditAction.PROJECT_CREATED,
					actorId: userId,
					targetId: created.id,
					targetType: "project",
					organizationId: actor.organizationId,
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
		),
	);
}

/**
 * Saves a project as a new template (org owners and admins only): its icon,
 * colour, budget, open tasks, managers and assignments, without a deadline
 * offset. Managers and assigned employees who have left the organization are
 * skipped and returned in `skipped`. The template is named after the project
 * unless `name` is given.
 */
export async function saveProjectAsTemplate(
	projectId: string,
	input: { name?: string } = {},
): Promise<ServerActionResult<{ id: string; name: string; skipped: SkippedProjectMember[] }>> {
	return runServerActionSafe(
		tracedProjectAction(
			"saveProjectAsTemplate",
			{ "project.id": projectId },
			Effect.gen(function* () {
				const admin = yield* getTemplateAdmin("saveFromProject");
				const source = yield* admin.actor.dbService.query("projectTemplate.readProject", () =>
					projectAsTemplateInput(db, { organizationId: admin.organizationId, projectId }),
				);
				if (!source) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Project not found",
							entityType: "project",
							entityId: projectId,
						}),
					);
				}
				const values = yield* normalizedTemplateInput({
					...source.input,
					name: input.name ?? source.project.name,
				});
				const created = yield* admin.actor.dbService
					.query("projectTemplate.saveFromProject", () =>
						db.transaction((tx) =>
							writeProjectTemplate(
								tx,
								{ organizationId: admin.organizationId, userId: admin.userId },
								values,
							),
						),
					)
					.pipe(Effect.mapError(keepTypedTemplateError));

				logAudit({
					action: AuditAction.PROJECT_TEMPLATE_CREATED,
					actorId: admin.userId,
					targetId: created.id,
					targetType: "project_template",
					organizationId: admin.organizationId,
					changes: { name: values.name, taskNames: values.tasks.map((task) => task.name) },
					metadata: {
						templateName: values.name,
						fromProjectId: source.project.id,
						skippedMembers: source.skipped,
					},
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				return { id: created.id, name: values.name, skipped: source.skipped };
			}),
		),
	);
}
