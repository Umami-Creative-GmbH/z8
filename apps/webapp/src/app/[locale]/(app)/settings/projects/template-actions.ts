"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import {
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	type NormalizedProjectTemplateInput,
	normalizeProjectTemplateInput,
	type ProjectTemplate,
	type ProjectTemplateInput,
	type ProjectTemplateInputProblem,
	type ProjectTemplateSummary,
} from "@/lib/projects/project-template-model";
import {
	deleteProjectTemplateRow,
	getProjectTemplate,
	isProjectTemplateNameConflict,
	listProjectTemplates,
	ProjectTemplateMemberError,
	writeProjectTemplate,
} from "@/lib/projects/project-templates";
import { getProjectSettingsActorContext, type ProjectSettingsActor } from "./project-scope";
import { tracedProjectAction as traced } from "./traced-project-action";

/**
 * Project template management (#878). Templates live under the project
 * settings and are managed by org owners and admins only; everyone else is
 * refused here on the server. Every action runs in the caller's active
 * organization.
 */

const TEMPLATE_ACCESS_DENIED = "Only organization admins can manage project templates";
const DUPLICATE_NAME_MESSAGE = "A project template with this name already exists";

const INPUT_PROBLEM_MESSAGES: Record<
	ProjectTemplateInputProblem,
	{ message: string; field: string }
> = {
	nameRequired: { message: "Template name is required", field: "name" },
	nameTooLong: { message: "Template name is too long", field: "name" },
	descriptionTooLong: { message: "Template description is too long", field: "description" },
	iconInvalid: { message: "Template icon is not valid", field: "icon" },
	colorInvalid: { message: "Template colour must be a hex colour", field: "color" },
	budgetInvalid: {
		message: "Template budget must be a positive number of hours",
		field: "budgetHours",
	},
	deadlineOffsetInvalid: {
		message: "Deadline offset must be a whole number of days from 0 to 3650",
		field: "deadlineOffsetDays",
	},
	tooManyTasks: { message: "A template can hold at most 200 tasks", field: "tasks" },
	taskNameRequired: { message: "Task name is required", field: "tasks" },
	taskNameTooLong: { message: "Task name is too long", field: "tasks" },
	taskNameDuplicate: { message: "Task names must be unique within the template", field: "tasks" },
	taskDescriptionTooLong: { message: "Task description is too long", field: "tasks" },
	taskEstimateInvalid: {
		message: "Task estimate must be a positive number of hours",
		field: "tasks",
	},
};

const MEMBER_PROBLEM_MESSAGES: Record<
	ProjectTemplateMemberError["problem"],
	{ message: string; field: string }
> = {
	employeeNotFound: { message: "Employee not found", field: "employees" },
	employeeDeparted: {
		message: "This employee has left the organization and cannot be added",
		field: "employees",
	},
	teamNotFound: { message: "Team not found", field: "teams" },
};

/** Typed failures raised inside a database callback keep their type. */
function keepTypedTemplateError(error: DatabaseError) {
	if (isProjectTemplateNameConflict(error.cause)) {
		return new ValidationError({ message: DUPLICATE_NAME_MESSAGE, field: "name" });
	}
	if (error.cause instanceof ProjectTemplateMemberError) {
		return new ValidationError(MEMBER_PROBLEM_MESSAGES[error.cause.problem]);
	}
	return error;
}

/** The caller as an org owner or admin of their active organization, or a refusal. */
function getTemplateAdmin(action: string) {
	return Effect.gen(function* () {
		const actor: ProjectSettingsActor = yield* getProjectSettingsActorContext({
			queryName: `projectTemplate.${action}:actor`,
		});
		if (actor.accessTier !== "orgAdmin") {
			return yield* Effect.fail(
				new AuthorizationError({
					message: TEMPLATE_ACCESS_DENIED,
					userId: actor.session.user.id,
					resource: "project_template",
					action,
				}),
			);
		}
		return { actor, userId: actor.session.user.id, organizationId: actor.organizationId };
	});
}

type TemplateAdmin = Effect.Success<ReturnType<typeof getTemplateAdmin>>;

function templateNotFound(templateId: string) {
	return new NotFoundError({
		message: "Project template not found",
		entityType: "project_template",
		entityId: templateId,
	});
}

function normalized(input: ProjectTemplateInput) {
	const result = normalizeProjectTemplateInput(input);
	return result.ok
		? Effect.succeed(result.value)
		: Effect.fail(new ValidationError(INPUT_PROBLEM_MESSAGES[result.problem]));
}

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

function auditTemplate(
	admin: TemplateAdmin,
	action: AuditAction,
	template: { id: string; name: string },
	changes?: Record<string, unknown>,
) {
	logAudit({
		action,
		actorId: admin.userId,
		targetId: template.id,
		targetType: "project_template",
		organizationId: admin.organizationId,
		changes,
		metadata: { templateName: template.name },
		timestamp: new Date(),
	}).catch((err) => logger.error({ err }, "Failed to log audit"));
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
				const values = yield* normalized(input);
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
				const values = yield* normalized(input);
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
