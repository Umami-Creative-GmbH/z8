import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { customer, type employee, project, projectManager } from "@/db/schema";
import { type DatabaseError, ValidationError } from "@/lib/effect/errors";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import type { SettingsAccessTier } from "@/lib/settings-access";

export interface ProjectSettingsActor {
	session: { user: { id: string }; session: { activeOrganizationId: string | null } };
	dbService: {
		query: <T>(name: string, fn: () => Promise<T>) => Effect.Effect<T, DatabaseError>;
	};
	organizationId: string;
	accessTier: SettingsAccessTier;
	currentEmployee: Pick<typeof employee.$inferSelect, "id" | "role"> | null;
}

export function getManagedProjectIdsForSettingsActor(actor: ProjectSettingsActor) {
	return Effect.gen(function* () {
		if (actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		if (actor.currentEmployee?.role !== "manager") {
			return new Set<string>();
		}

		const managedProjects = yield* actor.dbService.query(
			"getManagedProjectIdsForSettingsActor",
			async () => {
				return await db.query.projectManager.findMany({
					where: eq(projectManager.employeeId, actor.currentEmployee!.id),
					columns: { projectId: true },
				});
			},
		);

		return new Set(managedProjects.map((managedProject) => managedProject.projectId));
	});
}

export function filterItemsToManagedProjects<T extends { id: string }>(
	items: T[],
	managedProjectIds: Set<string> | null,
) {
	if (!managedProjectIds) {
		return items;
	}

	return items.filter((item) => managedProjectIds.has(item.id));
}

/**
 * Whether the project is in the actor's reach: a project of their organization
 * that they administer (org admin) or manage. Callers refuse with `refuseUnless`.
 */
export function reachesProject(
	actor: ProjectSettingsActor,
	targetProject: Pick<typeof project.$inferSelect, "id" | "organizationId">,
) {
	return Effect.gen(function* () {
		if (targetProject.organizationId !== actor.organizationId) return false;
		if (actor.accessTier === "orgAdmin") return true;
		const managedProjectIds = yield* getManagedProjectIdsForSettingsActor(actor);
		return managedProjectIds?.has(targetProject.id) ?? false;
	});
}

export function getManagedCustomerIdsForSettingsActor(actor: ProjectSettingsActor) {
	return Effect.gen(function* () {
		if (actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		const managedProjectIds = yield* getManagedProjectIdsForSettingsActor(actor);

		if (!managedProjectIds || managedProjectIds.size === 0) {
			return new Set<string>();
		}

		const customerProjects = yield* actor.dbService.query(
			"getManagedCustomerIdsForSettingsActor",
			async () => {
				return await db.query.project.findMany({
					where: and(eq(project.organizationId, actor.organizationId), eq(project.isActive, true)),
					columns: { id: true, customerId: true },
				});
			},
		);

		const customerProjectIds = new Map<string, Set<string>>();

		for (const customerProject of customerProjects) {
			if (!customerProject.customerId) {
				continue;
			}

			const existingProjectIds =
				customerProjectIds.get(customerProject.customerId) ?? new Set<string>();
			existingProjectIds.add(customerProject.id);
			customerProjectIds.set(customerProject.customerId, existingProjectIds);
		}

		const accessibleCustomerIds = [...customerProjectIds.entries()].flatMap(
			([customerId, projectIds]) =>
				[...projectIds].every((projectId) => managedProjectIds.has(projectId)) ? [customerId] : [],
		);

		return new Set(accessibleCustomerIds);
	});
}

function getCustomerProjects(actor: ProjectSettingsActor, customerId: string, queryName: string) {
	return actor.dbService.query(queryName, async () => {
		return await db.query.project.findMany({
			where: and(
				eq(project.organizationId, actor.organizationId),
				eq(project.customerId, customerId),
				eq(project.isActive, true),
			),
			columns: { id: true, organizationId: true },
		});
	});
}

/**
 * Whether the customer is in the actor's reach: a customer of their
 * organization that they administer (org admin), or whose active projects they
 * all manage. Callers refuse with `refuseUnless`.
 */
export function reachesCustomer(
	actor: ProjectSettingsActor,
	targetCustomer: Pick<typeof customer.$inferSelect, "id" | "organizationId">,
) {
	return Effect.gen(function* () {
		if (targetCustomer.organizationId !== actor.organizationId) return false;
		if (actor.accessTier === "orgAdmin") return true;
		const managedProjectIds = yield* getManagedProjectIdsForSettingsActor(actor);
		const customerProjects = yield* getCustomerProjects(
			actor,
			targetCustomer.id,
			"getCustomerProjectsForSettingsActor",
		);
		return (
			managedProjectIds !== null &&
			customerProjects.length > 0 &&
			customerProjects.every((customerProject) => managedProjectIds.has(customerProject.id))
		);
	});
}

/**
 * The active customer of the actor's organization that a project may be
 * created for: unknown customers fail validation, customers outside the
 * actor's reach fail authorization.
 */
export function loadAssignableCustomer(
	actor: ProjectSettingsActor,
	customerId: string,
	action: string,
) {
	return Effect.gen(function* () {
		const customerExists = yield* actor.dbService.query("verifyCustomer", async () => {
			return await db.query.customer.findFirst({
				where: and(
					eq(customer.id, customerId),
					eq(customer.organizationId, actor.organizationId),
					eq(customer.isActive, true),
				),
			});
		});

		if (!customerExists) {
			return yield* Effect.fail(
				new ValidationError({ message: "Customer not found", field: "customerId" }),
			);
		}

		yield* refuseUnless(yield* reachesCustomer(actor, customerExists), {
			userId: actor.session.user.id,
			message: "You do not have access to assign this customer",
			resource: "project",
			action,
		});
		return customerExists;
	});
}
