"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { customer, employee, project, projectManager } from "@/db/schema";
import { isUuid } from "@/lib/billable-time/input";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	CUSTOM_FIELD_ENTITIES,
	type CustomFieldEntity,
} from "@/lib/organization/custom-fields/definition-rules";
import {
	type CustomFieldSection,
	loadCustomFieldViewerLevel,
	readCustomFieldSection,
} from "@/lib/organization/custom-fields/values";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";

function notFound(entity: CustomFieldEntity, recordId: string) {
	return new NotFoundError({
		message: "Record not found",
		entityType: entity,
		entityId: recordId,
	});
}

function noAccess(actor: OrganizationActor, entity: CustomFieldEntity, message: string) {
	return new AuthorizationError({
		message,
		userId: actor.userId,
		resource: entity,
		action: "read",
	});
}

/** The projects a manager-tier caller manages as a project manager; null for an org admin. */
function managedProjectIds(actor: OrganizationActor) {
	return Effect.gen(function* () {
		if (actor.settingsAccess === "orgAdmin" || actor.settingsAccess === "owner") return null;
		const managerId = actor.employee?.role === "manager" ? actor.employee.id : null;
		if (!managerId) return new Set<string>();
		const dbService = yield* DatabaseService;
		const rows = yield* dbService.query("customFieldSection:managedProjects", () =>
			dbService.db
				.select({ projectId: projectManager.projectId })
				.from(projectManager)
				.where(eq(projectManager.employeeId, managerId)),
		);
		return new Set(rows.map((row) => row.projectId));
	});
}

/**
 * Confirms the caller reaches the record whose custom fields section is read:
 * org admins reach every record of the organization, scoped managers the
 * employees they manage and the projects (and customers whose every active
 * project) they manage. `recordId` null = a record being created. A record of
 * another organization is not found.
 */
function reachRecord(
	actor: OrganizationActor,
	organizationId: string,
	entity: CustomFieldEntity,
	recordId: string | null,
) {
	return Effect.gen(function* () {
		if (recordId !== null && !isUuid(recordId)) {
			return yield* Effect.fail(notFound(entity, recordId));
		}
		const dbService = yield* DatabaseService;

		if (entity === "employee") {
			if (recordId === null) {
				return yield* actor
					.require("orgAdmin")
					.pipe(
						Effect.mapError(() =>
							noAccess(actor, entity, "Only organization admins can create employee records"),
						),
					);
			}
			const target = yield* dbService.query("customFieldSection:employee", () =>
				dbService.db.query.employee.findFirst({
					where: and(eq(employee.id, recordId), eq(employee.organizationId, organizationId)),
					columns: { id: true },
				}),
			);
			if (!target) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: recordId,
					}),
				);
			}
			const scope = yield* actor.managedScope();
			if (scope.organizationWide) return;
			if (actor.employee?.role === "manager" && scope.employeeIds.has(target.id)) return;
			return yield* Effect.fail(noAccess(actor, entity, "You do not have access to this employee"));
		}

		if (recordId === null) return;
		const managed = yield* managedProjectIds(actor);

		if (entity === "project") {
			const target = yield* dbService.query("customFieldSection:project", () =>
				dbService.db.query.project.findFirst({
					where: and(eq(project.id, recordId), eq(project.organizationId, organizationId)),
					columns: { id: true },
				}),
			);
			if (!target) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Project not found",
						entityType: "project",
						entityId: recordId,
					}),
				);
			}
			if (managed === null || managed.has(target.id)) return;
			return yield* Effect.fail(noAccess(actor, entity, "You do not have access to this project"));
		}

		const target = yield* dbService.query("customFieldSection:customer", () =>
			dbService.db.query.customer.findFirst({
				where: and(eq(customer.id, recordId), eq(customer.organizationId, organizationId)),
				columns: { id: true },
			}),
		);
		if (!target) return yield* Effect.fail(notFound(entity, recordId));
		if (managed === null) return;
		const customerProjects = yield* dbService.query("customFieldSection:customerProjects", () =>
			dbService.db
				.select({ id: project.id })
				.from(project)
				.where(
					and(
						eq(project.organizationId, organizationId),
						eq(project.customerId, target.id),
						eq(project.isActive, true),
					),
				),
		);
		if (
			customerProjects.length > 0 &&
			customerProjects.every((customerProject) => managed.has(customerProject.id))
		) {
			return;
		}
		return yield* Effect.fail(noAccess(actor, entity, "You do not have access to this customer"));
	});
}

const customFieldSectionSchema = z.strictObject({
	entity: z.enum(CUSTOM_FIELD_ENTITIES, { error: "Unknown record kind" }),
	recordId: z.string().nullable(),
});

/**
 * The "Custom fields" section of an employee, project or customer (#818), or
 * of one being created (`recordId` null): the active fields the actor's level
 * sees, which of them they may change, the record's values and its missing
 * required values. Values of fields above the actor's visibility are never
 * returned. Records outside the actor's reach are refused.
 */
export const getCustomFieldSection = organizationAction(
	{ name: "customFields.section", requires: "scopedManager", schema: customFieldSectionSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* reachRecord(actor, organizationId, input.entity, input.recordId);
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"customFields.section",
				async (): Promise<CustomFieldSection> =>
					readCustomFieldSection(dbService.db, {
						organizationId,
						entity: input.entity,
						recordId: input.recordId,
						level: await loadCustomFieldViewerLevel(dbService.db, {
							organizationId,
							userId: actor.userId,
						}),
					}),
			);
		}),
);

/** No fields to show (`today` is unused then). */
const EMPTY_SECTION: CustomFieldSection = {
	fields: [],
	values: {},
	missingRequiredFieldIds: [],
	history: {},
	today: "",
};

/**
 * The signed-in user's own employee custom fields for their profile (#818):
 * the fields visible to employees, read-only (employees never edit values,
 * not even their own). Empty without an active employee record in the active
 * organization.
 */
export const getOwnCustomFieldValues = organizationAction(
	{ name: "customFields.ownSection", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"customFields.ownSection",
				async (): Promise<CustomFieldSection> => {
					const scope = { organizationId, userId: actor.userId };
					if ((await loadCustomFieldViewerLevel(dbService.db, scope)) === null) {
						return EMPTY_SECTION;
					}
					const [own] = await dbService.db
						.select({ id: employee.id })
						.from(employee)
						.where(
							and(
								eq(employee.organizationId, organizationId),
								eq(employee.userId, actor.userId),
								employeeHasOrganizationAccess(),
							),
						)
						.limit(1);
					if (!own) return EMPTY_SECTION;
					return readCustomFieldSection(dbService.db, {
						organizationId,
						entity: "employee",
						recordId: own.id,
						level: "employee",
					});
				},
			);
		}),
);
