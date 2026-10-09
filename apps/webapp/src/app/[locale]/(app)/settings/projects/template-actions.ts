"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { AuditAction } from "@/lib/audit-logger";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import type {
	NormalizedProjectTemplateInput,
	ProjectTemplate,
	ProjectTemplateInput,
	ProjectTemplateSummary,
} from "@/lib/projects/project-template-model";
import {
	deleteProjectTemplateRow,
	getProjectTemplate,
	listProjectTemplates,
	writeProjectTemplate,
} from "@/lib/projects/project-templates";
import {
	auditTemplate,
	getTemplateAdmin,
	keepTypedTemplateError,
	normalizedTemplateInput,
	type TemplateAdmin,
	templateNotFound,
} from "./project-template-access";
import { tracedProjectAction as traced } from "./traced-project-action";

/**
 * Project template management (#878). Templates live under the project
 * settings and are managed by org owners and admins only; everyone else is
 * refused here on the server. Every action runs in the caller's active
 * organization.
 */

function readTemplate(admin: TemplateAdmin, templateId: string, queryName: string) {
	return admin.actor.dbService
		.query(queryName, () =>
			getProjectTemplate({ organizationId: admin.organizationId, templateId }),
		)
		.pipe(
			Effect.flatMap((template) =>
				template ? Effect.succeed(template) : Effect.fail(templateNotFound(templateId)),
			),
		);
}

function auditedContents(values: NormalizedProjectTemplateInput) {
	const { tasks, ...rest } = values;
	return { ...rest, taskNames: tasks.map((task) => task.name) };
}

/** The organization's project templates, by name. */
export async function getProjectTemplates(): Promise<ServerActionResult<ProjectTemplateSummary[]>> {
	return runServerActionSafe(
		traced(
			"getProjectTemplates",
			{},
			Effect.gen(function* () {
				const admin = yield* getTemplateAdmin("list");
				return yield* admin.actor.dbService.query("listProjectTemplates", () =>
					listProjectTemplates({ organizationId: admin.organizationId }),
				);
			}),
		),
	);
}

/** One template with its tasks, managers and assignments, for the template editor. */
export async function getProjectTemplateDetails(
	templateId: string,
): Promise<ServerActionResult<ProjectTemplate>> {
	return runServerActionSafe(
		traced(
			"getProjectTemplateDetails",
			{ "template.id": templateId },
			Effect.gen(function* () {
				const admin = yield* getTemplateAdmin("read");
				return yield* readTemplate(admin, templateId, "getProjectTemplate");
			}),
		),
	);
}

export async function createProjectTemplate(
	input: ProjectTemplateInput,
): Promise<ServerActionResult<{ id: string }>> {
	return runServerActionSafe(
		traced(
			"createProjectTemplate",
			{},
			Effect.gen(function* () {
				const admin = yield* getTemplateAdmin("create");
				const values = yield* normalizedTemplateInput(input);
				const created = yield* admin.actor.dbService
					.query("projectTemplate.create", () =>
						db.transaction((tx) =>
							writeProjectTemplate(
								tx,
								{ organizationId: admin.organizationId, userId: admin.userId },
								values,
							),
						),
					)
					.pipe(Effect.mapError(keepTypedTemplateError));

				auditTemplate(
					admin,
					AuditAction.PROJECT_TEMPLATE_CREATED,
					{ id: created.id, name: values.name },
					auditedContents(values),
				);
				revalidatePath("/settings/projects");
				return created;
			}),
		),
	);
}

/**
 * Replaces everything a template holds. References to removed teams and
 * employees are dropped; a departed employee may stay but not be added.
 */
export async function updateProjectTemplate(
	templateId: string,
	input: ProjectTemplateInput,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		traced(
			"updateProjectTemplate",
			{ "template.id": templateId },
			Effect.gen(function* () {
				const admin = yield* getTemplateAdmin("update");
				const values = yield* normalizedTemplateInput(input);
				const existing = yield* readTemplate(admin, templateId, "projectTemplate.update:read");
				yield* admin.actor.dbService
					.query("projectTemplate.update", () =>
						db.transaction((tx) =>
							writeProjectTemplate(
								tx,
								{
									organizationId: admin.organizationId,
									userId: admin.userId,
									templateId: existing.id,
								},
								values,
							),
						),
					)
					.pipe(Effect.mapError(keepTypedTemplateError));

				auditTemplate(
					admin,
					AuditAction.PROJECT_TEMPLATE_UPDATED,
					{ id: existing.id, name: values.name },
					auditedContents(values),
				);
				revalidatePath("/settings/projects");
			}),
		),
	);
}

/** Deletes a template. Projects created from it are unaffected. */
export async function deleteProjectTemplate(templateId: string): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		traced(
			"deleteProjectTemplate",
			{ "template.id": templateId },
			Effect.gen(function* () {
				const admin = yield* getTemplateAdmin("delete");
				const existing = yield* readTemplate(admin, templateId, "projectTemplate.delete:read");
				const deleted = yield* admin.actor.dbService.query("projectTemplate.delete", () =>
					deleteProjectTemplateRow(db, {
						organizationId: admin.organizationId,
						templateId: existing.id,
					}),
				);
				if (!deleted) return yield* Effect.fail(templateNotFound(templateId));

				auditTemplate(admin, AuditAction.PROJECT_TEMPLATE_DELETED, existing);
				revalidatePath("/settings/projects");
			}),
		),
	);
}
