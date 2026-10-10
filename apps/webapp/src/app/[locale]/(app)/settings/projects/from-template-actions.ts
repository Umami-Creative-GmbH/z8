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
import {
	keepCustomFieldRefusal,
	saveFormCustomFieldValues,
} from "@/lib/organization/custom-fields/form-values";
import type { CustomFieldValuesInput } from "@/lib/organization/custom-fields/value-rules";
import { isProjectNameConflict, type NewProjectStatus } from "@/lib/projects/project-creation";
import {
	createProjectFromTemplateRows,
	projectAsTemplateInput,
	type SkippedManagerOrAssignment,
} from "@/lib/projects/project-from-template";
import {
	normalizeProjectTemplateInput,
	type ProjectTemplatePreviewData,
	type ProjectTemplateSummary,
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
	getProjectSettingsActorContext,
} from "./project-scope";
import {
	auditTemplate,
	getTemplateAdmin,
	keepTypedTemplateError,
	templateInputProblem,
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
	/** Billable default (#900); only a project with a customer can have it on. */
	billableDefault?: boolean;
	/** The dialog's custom field values (#818); required fields are enforced when present. */
	customFieldValues?: CustomFieldValuesInput;
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
 * which managers and assignments are no longer available. `managersCopied` is
 * false for a creator who is not an org owner or admin: only they assign
 * project managers (#367), so the template's managers are left out.
 */
export async function getProjectTemplatePreview(
	templateId: string,
): Promise<ServerActionResult<ProjectTemplatePreviewData>> {
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
				return { ...template, managersCopied: actor.accessTier === "orgAdmin" };
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
): Promise<ServerActionResult<{ id: string; skipped: SkippedManagerOrAssignment[] }>> {
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

				// The same billable default rules as a hand-made project (#900).
				yield* requireBillableTimeForDefaultChange(actor.dbService, actor.organizationId, {
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
				const created = yield* actor.dbService
					.query("project.createFromTemplate", () =>
						withOrganizationConfigurationMutation(db, actor.organizationId, async (tx) => {
							const copied = await createProjectFromTemplateRows(
								tx,
								{
									organizationId: actor.organizationId,
									userId,
									templateId: input.templateId,
									now: systemClock.nowInstant(),
									alsoManagedBy:
										actor.accessTier === "manager" ? (actor.currentEmployee?.id ?? null) : null,
									assignsManagers: actor.accessTier === "orgAdmin",
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
									organizationId: actor.organizationId,
									actorUserId: userId,
									entity: "project",
									recordId: copied.id,
									values: input.customFieldValues,
								});
							}
							return copied;
						}),
					)
					.pipe(Effect.mapError((error) => keepCustomFieldRefusal(keepTypedCreationError(error))));
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
): Promise<
	ServerActionResult<{ id: string; name: string; skipped: SkippedManagerOrAssignment[] }>
> {
	return runServerActionSafe(
		tracedProjectAction(
			"saveProjectAsTemplate",
			{ "project.id": projectId },
			Effect.gen(function* () {
				const admin = yield* getTemplateAdmin("saveFromProject");
				// One transaction reads the project and writes the template, so someone
				// leaving in between is skipped and reported, never refusing the save.
				const saved = yield* admin.actor.dbService
					.query("projectTemplate.saveFromProject", () =>
						db.transaction(async (tx) => {
							const source = await projectAsTemplateInput(tx, {
								organizationId: admin.organizationId,
								projectId,
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
								{ organizationId: admin.organizationId, userId: admin.userId },
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
							entityId: projectId,
						}),
					);
				}

				auditTemplate(
					admin,
					AuditAction.PROJECT_TEMPLATE_CREATED,
					{ id: saved.id, name: saved.values.name },
					{ name: saved.values.name, taskNames: saved.values.tasks.map((task) => task.name) },
					{ fromProjectId: saved.projectId, skippedMembers: saved.skipped },
				);

				revalidatePath("/settings/projects");
				return { id: saved.id, name: saved.values.name, skipped: saved.skipped };
			}),
		),
	);
}
