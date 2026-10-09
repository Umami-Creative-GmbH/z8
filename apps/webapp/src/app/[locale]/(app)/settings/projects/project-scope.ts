import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { type customer, employee, project, projectManager } from "@/db/schema";
import { AuthorizationError, type DatabaseError, NotFoundError } from "@/lib/effect/errors";
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

/** What a refused project settings access reports. */
interface AuthorizationFailureDetails {
	message: string;
	resource: string;
	action: string;
}

function actorAuthorizationError(
	actor: { session: { user: { id: string } } },
	options: AuthorizationFailureDetails,
) {
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
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession(options?.organizationId);
		const dbService = yield* DatabaseService;
		const organizationId = options?.organizationId ?? session.session.activeOrganizationId;

		if (!organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "No active organization selected",
					userId: session.user.id,
					resource: "project_settings",
					action: "access",
				}),
			);
		}

		const [membershipRecord, employeeRecord] = yield* Effect.all([
			dbService.query(`${options?.queryName ?? "getProjectSettingsActor"}:membership`, async () => {
				return await db.query.member.findFirst({
					where: and(
						eq(member.userId, session.user.id),
						eq(member.organizationId, organizationId),
						eq(member.status, "approved"),
					),
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
		]);
		const authorizedEmployeeRecord = membershipRecord ? employeeRecord : null;

		const accessTier = resolveSettingsAccessTier({
			activeOrganizationId: organizationId,
			membershipRole: isSettingsAccessMembershipRole(membershipRecord?.role)
				? membershipRecord.role
				: null,
			employeeRole: authorizedEmployeeRecord?.role ?? null,
		});

		if (accessTier === "member") {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "You do not have access to project settings",
					userId: session.user.id,
					resource: "project_settings",
					action: "access",
				}),
			);
		}

		return {
			session,
			dbService,
			organizationId,
			accessTier,
			currentEmployee: authorizedEmployeeRecord ?? null,
		};
	});
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

export function ensureSettingsActorCanAccessProjectTarget(
	actor: ProjectSettingsActor,
	targetProject: Pick<typeof project.$inferSelect, "id" | "organizationId">,
	options: AuthorizationFailureDetails,
) {
	return Effect.gen(function* () {
		if (targetProject.organizationId !== actor.organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Cannot access project from different organization",
					userId: actor.session.user.id,
					resource: options.resource,
					action: options.action,
				}),
			);
		}

		if (actor.accessTier === "orgAdmin") {
			return;
		}

		const managedProjectIds = yield* getManagedProjectIdsForSettingsActor(actor);

		if (managedProjectIds?.has(targetProject.id)) {
			return;
		}

		return yield* Effect.fail(actorAuthorizationError(actor, options));
	});
}

/**
 * Adding or removing project managers is reserved for org admins (#367):
 * a manager-tier project manager may manage assignments, not other managers.
 */
export function ensureSettingsActorCanManageProjectManagers(
	actor: ProjectSettingsActor,
	targetProject: Pick<typeof project.$inferSelect, "id" | "organizationId">,
	options: AuthorizationFailureDetails,
) {
	return Effect.gen(function* () {
		yield* ensureSettingsActorCanAccessProjectTarget(actor, targetProject, options);

		if (actor.accessTier !== "orgAdmin") {
			return yield* Effect.fail(actorAuthorizationError(actor, options));
		}
	});
}

/**
 * Managing a project's tasks (#872): org admins and owners for any project of
 * their organization, manager-tier project managers only for the projects
 * they manage. Member-tier employees never reach this (the actor context
 * refuses them), even when they are listed as a project's manager.
 */
export function ensureSettingsActorCanManageProjectTasks(
	actor: ProjectSettingsActor,
	targetProject: Pick<typeof project.$inferSelect, "id" | "organizationId">,
	options: AuthorizationFailureDetails,
) {
	return ensureSettingsActorCanAccessProjectTarget(actor, targetProject, options);
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

export function ensureSettingsActorCanAccessCustomerTarget(
	actor: ProjectSettingsActor,
	targetCustomer: Pick<typeof customer.$inferSelect, "id" | "organizationId">,
	options: AuthorizationFailureDetails,
) {
	return Effect.gen(function* () {
		if (targetCustomer.organizationId !== actor.organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Cannot access customer from different organization",
					userId: actor.session.user.id,
					resource: options.resource,
					action: options.action,
				}),
			);
		}

		if (actor.accessTier === "orgAdmin") {
			return;
		}

		const managedProjectIds = yield* getManagedProjectIdsForSettingsActor(actor);
		const customerProjects = yield* getCustomerProjects(
			actor,
			targetCustomer.id,
			"getCustomerProjectsForSettingsActor",
		);

		if (
			managedProjectIds &&
			customerProjects.length > 0 &&
			customerProjects.every((customerProject) => managedProjectIds.has(customerProject.id))
		) {
			return;
		}

		return yield* Effect.fail(actorAuthorizationError(actor, options));
	});
}

export function getProjectTarget(projectId: string, queryName = "getProjectTarget") {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		return yield* dbService
			.query(queryName, async () => {
				return await db.query.project.findFirst({
					where: eq(project.id, projectId),
				});
			})
			.pipe(
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
