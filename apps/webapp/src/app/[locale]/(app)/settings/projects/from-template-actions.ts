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
	type SkippedProjectMember,
} from "@/lib/projects/project-from-template";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction";
import {
	ensureSettingsActorCanUseProjectCustomer,
	getProjectSettingsActorContext,
} from "./project-scope";
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

function templateNotFound(templateId: string) {
	return new NotFoundError({
		message: "Project template not found",
		entityType: "project_template",
		entityId: templateId,
	});
}

function keepTypedCreationError(error: DatabaseError) {
	return isProjectNameConflict(error.cause)
		? new ValidationError({ message: DUPLICATE_PROJECT_NAME, field: "name" })
		: error;
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
