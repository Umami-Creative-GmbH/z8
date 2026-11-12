"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { AuditAction } from "@/lib/audit-logger";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import type { NormalizedProjectTemplateInput } from "@/lib/projects/project-template-model";
import {
	deleteProjectTemplateRow,
	getProjectTemplate,
	listProjectTemplates,
	writeProjectTemplate,
} from "@/lib/projects/project-templates";
import {
	auditTemplate,
	keepTypedTemplateError,
	normalizedTemplateInput,
	projectTemplateInputSchema,
	templateEmployeeIds,
	templateNotFound,
} from "./project-template-access";

/**
 * Project template management (#878). Templates live under the project
 * settings and are managed by org owners and admins only (settings access
 * `orgAdmin`); everyone else is refused here on the server. Every action runs
 * in the session's active organization.
 */

const templateId = z.string().min(1, "Template is required");

function readTemplate(organizationId: string, templateId: string, queryName: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const template = yield* dbService.query(queryName, () =>
			getProjectTemplate({ organizationId, templateId }),
		);
		return template ?? (yield* Effect.fail(templateNotFound(templateId)));
	});
}

function auditedContents(values: NormalizedProjectTemplateInput) {
	const { tasks, ...rest } = values;
	return { ...rest, taskNames: tasks.map((task) => task.name) };
}

/** The organization's project templates, by name. */
export const getProjectTemplates = organizationAction(
	{ name: "projectTemplate.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("projectTemplate.list", () =>
				listProjectTemplates({ organizationId }),
			);
		}),
);

/** One template with its tasks, managers and assignments, for the template editor. */
export const getProjectTemplateDetails = organizationAction(
	{ name: "projectTemplate.get", requires: "orgAdmin", schema: templateId },
	({ organizationId, input }) => readTemplate(organizationId, input, "projectTemplate.get"),
);

/** Creates a template; a former employee cannot become its manager or assignee. */
export const createProjectTemplate = organizationAction(
	{
		name: "projectTemplate.create",
		requires: "orgAdmin",
		schema: projectTemplateInputSchema,
		addsEmployees: templateEmployeeIds,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const values = yield* normalizedTemplateInput(input);
			const dbService = yield* DatabaseService;
			const created = yield* dbService
				.query("projectTemplate.create", () =>
					dbService.db.transaction((tx) =>
						writeProjectTemplate(tx, { organizationId, userId: actor.userId }, values),
					),
				)
				.pipe(Effect.mapError(keepTypedTemplateError));

			auditTemplate(
				{ userId: actor.userId, organizationId },
				AuditAction.PROJECT_TEMPLATE_CREATED,
				{ id: created.id, name: values.name },
				auditedContents(values),
			);
			revalidatePath("/settings/projects");
			return created;
		}),
);

/**
 * Replaces everything a template holds. References to removed teams and
 * employees are dropped; a departed employee may stay but not be added, which
 * `writeProjectTemplate` checks against what the template already holds.
 */
export const updateProjectTemplate = organizationAction(
	{
		name: "projectTemplate.update",
		requires: "orgAdmin",
		schema: projectTemplateInputSchema.extend({ templateId }),
	},
	({ actor, organizationId, input: { templateId, ...input } }) =>
		Effect.gen(function* () {
			const values = yield* normalizedTemplateInput(input);
			const existing = yield* readTemplate(
				organizationId,
				templateId,
				"projectTemplate.update:read",
			);
			const dbService = yield* DatabaseService;
			yield* dbService
				.query("projectTemplate.update", () =>
					dbService.db.transaction((tx) =>
						writeProjectTemplate(
							tx,
							{ organizationId, userId: actor.userId, templateId: existing.id },
							values,
						),
					),
				)
				.pipe(Effect.mapError(keepTypedTemplateError));

			auditTemplate(
				{ userId: actor.userId, organizationId },
				AuditAction.PROJECT_TEMPLATE_UPDATED,
				{ id: existing.id, name: values.name },
				auditedContents(values),
			);
			revalidatePath("/settings/projects");
		}),
);

/** Deletes a template. Projects created from it are unaffected. */
export const deleteProjectTemplate = organizationAction(
	{ name: "projectTemplate.delete", requires: "orgAdmin", schema: templateId },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const existing = yield* readTemplate(organizationId, input, "projectTemplate.delete:read");
			const dbService = yield* DatabaseService;
			const deleted = yield* dbService.query("projectTemplate.delete", () =>
				deleteProjectTemplateRow(dbService.db, { organizationId, templateId: existing.id }),
			);
			if (!deleted) return yield* Effect.fail(templateNotFound(input));

			auditTemplate(
				{ userId: actor.userId, organizationId },
				AuditAction.PROJECT_TEMPLATE_DELETED,
				existing,
			);
			revalidatePath("/settings/projects");
		}),
);
