"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { customer, employee } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
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
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
	getTargetEmployee,
	requireOrgAdminEmployeeSettingsAccess,
} from "../employees/employee-action-utils";
import {
	ensureSettingsActorCanAccessCustomerTarget,
	ensureSettingsActorCanAccessProjectTarget,
	getProjectSettingsActorContext,
	getProjectTarget,
} from "../projects/project-scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(entity: CustomFieldEntity, recordId: string) {
	return new NotFoundError({
		message: "Record not found",
		entityType: entity,
		entityId: recordId,
	});
}

/**
 * The organization and user whose custom fields section of `recordId` is read,
 * after the existing settings scope confirmed the user reaches the record
 * (managers: the employees they manage, the projects and customers they can
 * see). `recordId` null = a record being created.
 */
function reachRecord(entity: CustomFieldEntity, recordId: string | null) {
	return Effect.gen(function* () {
		if (recordId !== null && !UUID.test(recordId)) {
			return yield* Effect.fail(notFound(entity, recordId));
		}
		const denied = { resource: entity, action: "read" };
		if (entity === "employee") {
			const actor = yield* getEmployeeSettingsActorContext({
				queryName: "customFieldSection:employeeActor",
			});
			if (recordId === null) {
				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					...denied,
					message: "Only organization admins can create employee records",
				});
			} else {
				const target = yield* getTargetEmployee(recordId, "customFieldSection:employee");
				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, target, {
					...denied,
					message: "You do not have access to this employee",
				});
			}
			return { organizationId: actor.organizationId, userId: actor.session.user.id };
		}

		const actor = yield* getProjectSettingsActorContext({
			queryName: `customFieldSection:${entity}Actor`,
		});
		if (recordId !== null && entity === "project") {
			const target = yield* getProjectTarget(recordId, "customFieldSection:project");
			yield* ensureSettingsActorCanAccessProjectTarget(actor, target, {
				...denied,
				message: "You do not have access to this project",
			});
		}
		if (recordId !== null && entity === "customer") {
			const target = yield* actor.dbService.query("customFieldSection:customer", () =>
				actor.dbService.db.query.customer.findFirst({
					where: and(eq(customer.id, recordId), eq(customer.organizationId, actor.organizationId)),
					columns: { id: true, organizationId: true },
				}),
			);
			if (!target) return yield* Effect.fail(notFound(entity, recordId));
			yield* ensureSettingsActorCanAccessCustomerTarget(actor, target, {
				...denied,
				message: "You do not have access to this customer",
			});
		}
		return { organizationId: actor.organizationId, userId: actor.session.user.id };
	});
}

/**
 * The "Custom fields" section of an employee, project or customer (#818), or
 * of one being created (`recordId` null): the active fields the actor's level
 * sees, which of them they may change, the record's values and its missing
 * required values. Values of fields above the actor's visibility are never
 * returned. Records outside the actor's reach are refused.
 */
export async function getCustomFieldSection(input: {
	entity: CustomFieldEntity;
	recordId: string | null;
}): Promise<ServerActionResult<CustomFieldSection>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			if (!(CUSTOM_FIELD_ENTITIES as readonly string[]).includes(input.entity)) {
				return yield* Effect.fail(
					new ValidationError({ message: "Unknown record kind", field: "entity" }),
				);
			}
			const scope = yield* reachRecord(input.entity, input.recordId);
			const dbService = yield* DatabaseService;
			return yield* dbService.query("customFields.section", async () =>
				readCustomFieldSection(dbService.db, {
					organizationId: scope.organizationId,
					entity: input.entity,
					recordId: input.recordId,
					level: await loadCustomFieldViewerLevel(dbService.db, scope),
				}),
			);
		}),
	);
}

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
export async function getOwnCustomFieldValues(): Promise<ServerActionResult<CustomFieldSection>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const authService = yield* AuthService;
			const session = yield* authService.getSession();
			const organizationId = session.session.activeOrganizationId;
			if (!organizationId) return EMPTY_SECTION;
			const dbService = yield* DatabaseService;
			return yield* dbService.query("customFields.ownSection", async () => {
				const scope = { organizationId, userId: session.user.id };
				if ((await loadCustomFieldViewerLevel(dbService.db, scope)) === null) return EMPTY_SECTION;
				const [own] = await dbService.db
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(
							eq(employee.organizationId, organizationId),
							eq(employee.userId, session.user.id),
							eq(employee.isActive, true),
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
			});
		}),
	);
}
