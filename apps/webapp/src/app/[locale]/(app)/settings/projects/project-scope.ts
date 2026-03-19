import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { member } from "@/db/auth-schema";
import { db } from "@/db";
import { customer, employee, project, projectManager } from "@/db/schema";
import { AuthorizationError, DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	isSettingsAccessMembershipRole,
	resolveSettingsAccessTier,
	type SettingsAccessTier,
} from "@/lib/settings-access";

export interface ProjectSettingsActor {
	session: { user: { id: string }; session: { activeOrganizationId: string | null } };
	dbService: {
		query: <T>(name: string, fn: () => Promise<T>) => Effect.Effect<T, DatabaseError>;
	};
	organizationId: string;
	accessTier: SettingsAccessTier;
	currentEmployee: typeof employee.$inferSelect | null;
}

function actorAuthorizationError(actor: { session: { user: { id: string } } }, options: {
	message: string;
	resource: string;
	action: string;
}) {
	return new AuthorizationError({
		message: options.message,
		userId: actor.session.user.id,
		resource: options.resource,
		action: options.action,
	});
}

export function getProjectSettingsActorContext(options?: {
	organizationId?: string;
	queryName?: string;
}) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const organizationId = options?.organizationId ?? session.session.activeOrganizationId;

		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "No active organization selected",
						userId: session.user.id,
						resource: "project_settings",
						action: "access",
					}),
				),
			);
		}

		const [membershipRecord, employeeRecord] = yield* _(
			Effect.all([
				dbService.query(`${options?.queryName ?? "getProjectSettingsActor"}:membership`, async () => {
					return await db.query.member.findFirst({
						where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)),
						columns: { role: true },
					});
				}),
				dbService.query(`${options?.queryName ?? "getProjectSettingsActor"}:employee`, async () => {
					return await db.query.employee.findFirst({
						where: and(
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
						),
					});
				}),
			]),
		);

		const accessTier = resolveSettingsAccessTier({
			activeOrganizationId: organizationId,
			membershipRole: isSettingsAccessMembershipRole(membershipRecord?.role)
				? membershipRecord.role
				: null,
			employeeRole: employeeRecord?.role ?? null,
		});

		if (accessTier === "member") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "You do not have access to project settings",
						userId: session.user.id,
						resource: "project_settings",
						action: "access",
					}),
				),
			);
		}

		return {
			session,
			dbService,
			organizationId,
			accessTier,
			currentEmployee: employeeRecord ?? null,
		};
	});
}

export function getManagedProjectIdsForSettingsActor(actor: ProjectSettingsActor) {
	return Effect.gen(function* (_) {
		if (actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		if (!actor.currentEmployee || actor.currentEmployee.role !== "manager") {
			return new Set<string>();
		}

		const managedProjects = yield* _(
			actor.dbService.query("getManagedProjectIdsForSettingsActor", async () => {
				return await db.query.projectManager.findMany({
					where: eq(projectManager.employeeId, actor.currentEmployee!.id),
					columns: { projectId: true },
				});
			}),
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

export function ensureSettingsActorCanAccessProjectTarget(
	actor: ProjectSettingsActor,
	targetProject: Pick<typeof project.$inferSelect, "id" | "organizationId">,
	options: {
		message: string;
		resource: string;
		action: string;
	},
) {
	return Effect.gen(function* (_) {
		if (targetProject.organizationId !== actor.organizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot access project from different organization",
						userId: actor.session.user.id,
						resource: options.resource,
						action: options.action,
					}),
				),
			);
		}

		if (actor.accessTier === "orgAdmin") {
			return;
		}

		const managedProjectIds = yield* _(getManagedProjectIdsForSettingsActor(actor));

		if (managedProjectIds?.has(targetProject.id)) {
			return;
		}

		return yield* _(Effect.fail(actorAuthorizationError(actor, options)));
	});
}

export function getManagedCustomerIdsForSettingsActor(actor: ProjectSettingsActor) {
	return Effect.gen(function* (_) {
		if (actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		const managedProjectIds = yield* _(getManagedProjectIdsForSettingsActor(actor));

		if (!managedProjectIds || managedProjectIds.size === 0) {
			return new Set<string>();
		}

		const customerProjects = yield* _(
			actor.dbService.query("getManagedCustomerIdsForSettingsActor", async () => {
				return await db.query.project.findMany({
					where: and(
						eq(project.organizationId, actor.organizationId),
						eq(project.isActive, true),
					),
					columns: { id: true, customerId: true },
				});
			}),
		);

		const customerProjectIds = new Map<string, Set<string>>();

		for (const customerProject of customerProjects) {
			if (!customerProject.customerId) {
				continue;
			}

			const existingProjectIds = customerProjectIds.get(customerProject.customerId) ?? new Set<string>();
			existingProjectIds.add(customerProject.id);
			customerProjectIds.set(customerProject.customerId, existingProjectIds);
		}

		const accessibleCustomerIds = [...customerProjectIds.entries()]
			.filter(([, projectIds]) => [...projectIds].every((projectId) => managedProjectIds.has(projectId)))
			.map(([customerId]) => customerId);

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

export function ensureSettingsActorCanAccessCustomerTarget(
	actor: ProjectSettingsActor,
	targetCustomer: Pick<typeof customer.$inferSelect, "id" | "organizationId">,
	options: {
		message: string;
		resource: string;
		action: string;
	},
) {
	return Effect.gen(function* (_) {
		if (targetCustomer.organizationId !== actor.organizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot access customer from different organization",
						userId: actor.session.user.id,
						resource: options.resource,
						action: options.action,
					}),
				),
			);
		}

		if (actor.accessTier === "orgAdmin") {
			return;
		}

		const managedProjectIds = yield* _(getManagedProjectIdsForSettingsActor(actor));
		const customerProjects = yield* _(
			getCustomerProjects(actor, targetCustomer.id, "getCustomerProjectsForSettingsActor"),
		);

		if (
			managedProjectIds &&
			customerProjects.length > 0 &&
			customerProjects.every((customerProject) => managedProjectIds.has(customerProject.id))
		) {
			return;
		}

		return yield* _(Effect.fail(actorAuthorizationError(actor, options)));
	});
}

export function getProjectTarget(projectId: string, queryName = "getProjectTarget") {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return yield* _(
			dbService.query(queryName, async () => {
				return await db.query.project.findFirst({
					where: eq(project.id, projectId),
				});
			}),
			Effect.flatMap((value) =>
				value
					? Effect.succeed(value)
					: Effect.fail(
							new NotFoundError({
								message: "Project not found",
								entityType: "project",
								entityId: projectId,
							}),
						),
			),
		);
	});
}
