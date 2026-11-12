import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import * as z from "zod";
import { customer, project } from "@/db/schema";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import type { CustomFieldValuesInput } from "@/lib/organization/custom-fields/value-rules";
import type { ProjectSettingsActor } from "./project-scope";

/**
 * The project settings actor of an `organizationAction` caller (#1615): an org
 * admin reaches every project and customer, a scoped manager the projects they
 * manage (and the customers only those projects use), as before.
 */
export function projectSettingsActorOf(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return {
			session: { user: { id: actor.userId }, session: { activeOrganizationId: organizationId } },
			dbService,
			organizationId,
			accessTier: meetsSettingsAccess(actor.settingsAccess, "orgAdmin")
				? "orgAdmin"
				: actor.settingsAccess === "scopedManager"
					? "manager"
					: "member",
			currentEmployee: actor.employee,
		} satisfies ProjectSettingsActor;
	});
}

/** The project `projectId` of the organization; another organization's reads as not found. */
export function loadOrganizationProject(organizationId: string, projectId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = yield* dbService.query("project.getInOrganization", () =>
			dbService.db.query.project.findFirst({
				where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
			}),
		);
		if (!row) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Project not found",
					entityType: "project",
					entityId: projectId,
				}),
			);
		}
		return row;
	});
}

/** The customer `customerId` of the organization; another organization's reads as not found. */
export function loadOrganizationCustomer(organizationId: string, customerId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = yield* dbService.query("customer.getInOrganization", () =>
			dbService.db.query.customer.findFirst({
				where: and(eq(customer.id, customerId), eq(customer.organizationId, organizationId)),
			}),
		);
		if (!row) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Customer not found",
					entityType: "customer",
					entityId: customerId,
				}),
			);
		}
		return row;
	});
}

/** A form's custom field values by field id (#818); `saveFormCustomFieldValues` checks each value. */
export const customFieldValuesSchema = z.custom<CustomFieldValuesInput>(
	(value) => typeof value === "object" && value !== null && !Array.isArray(value),
	{ message: "Invalid custom field values" },
);
