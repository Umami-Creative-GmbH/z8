import { Effect } from "effect";
import { type AuditAction, logAudit } from "@/lib/audit-logger";
import {
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { logger } from "@/lib/logger";
import {
	normalizeProjectTemplateInput,
	type ProjectTemplateInput,
	type ProjectTemplateInputProblem,
} from "@/lib/projects/project-template-model";
import {
	isProjectTemplateNameConflict,
	ProjectTemplateReferenceError,
} from "@/lib/projects/project-templates";
import { getProjectSettingsActorContext, type ProjectSettingsActor } from "./project-scope";

/**
 * Who may manage project templates (org owners and admins, #878) and how
 * template failures read, shared by the template actions and "save as
 * template" (#880).
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

const REFERENCE_PROBLEM_MESSAGES: Record<
	ProjectTemplateReferenceError["problem"],
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
export function keepTypedTemplateError(error: DatabaseError) {
	if (isProjectTemplateNameConflict(error.cause)) {
		return new ValidationError({ message: DUPLICATE_NAME_MESSAGE, field: "name" });
	}
	if (error.cause instanceof ProjectTemplateReferenceError) {
		return new ValidationError(REFERENCE_PROBLEM_MESSAGES[error.cause.problem]);
	}
	if (error.cause instanceof ValidationError) return error.cause;
	return error;
}

/** The refusal for template input that breaks the input rules. */
export function templateInputProblem(problem: ProjectTemplateInputProblem) {
	return new ValidationError(INPUT_PROBLEM_MESSAGES[problem]);
}

/** Records a template change in the audit log; a failed write is logged, never thrown. */
export function auditTemplate(
	admin: TemplateAdmin,
	action: AuditAction,
	template: { id: string; name: string },
	changes?: Record<string, unknown>,
	metadata: Record<string, unknown> = {},
) {
	logAudit({
		action,
		actorId: admin.userId,
		targetId: template.id,
		targetType: "project_template",
		organizationId: admin.organizationId,
		changes,
		metadata: { templateName: template.name, ...metadata },
		timestamp: new Date(),
	}).catch((err) => logger.error({ err }, "Failed to log audit"));
}

/** The caller as an org owner or admin of their active organization, or a refusal. */
export function getTemplateAdmin(action: string) {
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

export type TemplateAdmin = Effect.Success<ReturnType<typeof getTemplateAdmin>>;

export function templateNotFound(templateId: string) {
	return new NotFoundError({
		message: "Project template not found",
		entityType: "project_template",
		entityId: templateId,
	});
}

export function normalizedTemplateInput(input: ProjectTemplateInput) {
	const result = normalizeProjectTemplateInput(input);
	return result.ok ? Effect.succeed(result.value) : Effect.fail(templateInputProblem(result.problem));
}
