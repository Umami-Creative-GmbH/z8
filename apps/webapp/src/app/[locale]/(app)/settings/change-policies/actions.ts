"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
	changePolicy,
	changePolicyAssignment,
	employee,
	team,
	teamPermissions,
} from "@/db/schema";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
	requireOrgAdminEmployeeSettingsAccess,
} from "../employees/employee-action-utils";

// ============================================
// TYPES
// ============================================

export type ChangePolicyRecord = typeof changePolicy.$inferSelect;

export type ChangePolicyAssignmentWithDetails = typeof changePolicyAssignment.$inferSelect & {
	policy: {
		id: string;
		name: string;
		selfServiceDays: number;
		approvalDays: number;
		noApprovalRequired: boolean;
	} | null;
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
};

export interface CreateChangePolicyInput {
	name: string;
	description?: string;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired?: boolean;
	notifyAllManagers?: boolean;
}

export interface UpdateChangePolicyInput {
	name?: string;
	description?: string;
	selfServiceDays?: number;
	approvalDays?: number;
	noApprovalRequired?: boolean;
	notifyAllManagers?: boolean;
	isActive?: boolean;
}

export interface CreateAssignmentInput {
	policyId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
	effectiveFrom?: Date;
	effectiveUntil?: Date;
}

type DatabaseClient = typeof import("@/db").db;

type ChangePolicyScopedActor = {
	accessTier: "manager" | "orgAdmin";
	organizationId: string;
	session: { user: { id: string } };
	currentEmployee: {
		id: string;
		organizationId: string;
		role: "admin" | "manager" | "employee";
	} | null;
	dbService: {
		db: DatabaseClient;
		query: <T>(key: string, fn: () => Promise<T>) => Effect.Effect<T, AnyAppError, never>;
	};
};

type ChangePolicyScopeAssignment = {
	policyId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
};

type TeamPermissionRow = {
	teamId: string | null;
	canManageTeamSettings: boolean;
};

type ManagedScopeEmployee = {
	id: string;
	teamId: string | null;
};

type ScopedChangePolicyAccessContext = {
	actor: ChangePolicyScopedActor;
	managedEmployeeIds: Set<string> | null;
	manageableTeamIds: Set<string> | null;
};

function filterAssignmentsForManagerChangePolicyScope<T extends ChangePolicyScopeAssignment>(
	assignments: T[],
	manageableTeamIds: Set<string> | null,
	managedEmployeeIds: Set<string> | null,
) {
	if (!manageableTeamIds || !managedEmployeeIds) {
		return assignments;
	}

	return assignments.filter((assignment) => {
		if (assignment.assignmentType === "organization") {
			return false;
		}

		if (assignment.assignmentType === "team") {
			return assignment.teamId ? manageableTeamIds.has(assignment.teamId) : false;
		}

		return assignment.employeeId ? managedEmployeeIds.has(assignment.employeeId) : false;
	});
}

function getScopedChangePolicyAccessContext(organizationId: string, queryName: string) {
	return Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName }),
		)) as ChangePolicyScopedActor;

		if (actor.accessTier === "orgAdmin") {
			return {
				actor,
				managedEmployeeIds: null,
				manageableTeamIds: null,
			} satisfies ScopedChangePolicyAccessContext;
		}

		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const teamPermissionRows = actor.currentEmployee
			? ((yield* _(
					actor.dbService.query(`${queryName}:teamPermissions`, async () => {
						return await actor.dbService.db.query.teamPermissions.findMany({
							where: and(
								eq(teamPermissions.employeeId, actor.currentEmployee?.id ?? ""),
								eq(teamPermissions.organizationId, organizationId),
							),
							columns: { teamId: true, canManageTeamSettings: true },
						});
					}),
				)) as TeamPermissionRow[])
			: [];

		const manageableTeamIds = new Set(
			teamPermissionRows
				.filter((permission) => permission.canManageTeamSettings && permission.teamId)
				.map((permission) => permission.teamId as string),
		);

		return {
			actor,
			managedEmployeeIds,
			manageableTeamIds,
		} satisfies ScopedChangePolicyAccessContext;
	});
}

function getVisibleScopedChangePolicyIds(
	actor: ChangePolicyScopedActor,
	organizationId: string,
	manageableTeamIds: Set<string> | null,
	managedEmployeeIds: Set<string> | null,
	queryName: string,
) {
	return Effect.gen(function* (_) {
		if (!manageableTeamIds || !managedEmployeeIds) {
			return null;
		}

		const assignmentRows = (yield* _(
			actor.dbService.query(queryName, async () => {
				return await actor.dbService.db.query.changePolicyAssignment.findMany({
					where: and(
						eq(changePolicyAssignment.organizationId, organizationId),
						eq(changePolicyAssignment.isActive, true),
					),
					columns: {
						policyId: true,
						assignmentType: true,
						teamId: true,
						employeeId: true,
					},
				});
			}),
		)) as ChangePolicyScopeAssignment[];

		const visibleAssignments = yield* _(
			getVisibleChangePolicyAssignmentsForManagerScope(
				actor,
				organizationId,
				assignmentRows,
				manageableTeamIds,
				managedEmployeeIds,
				`${queryName}:managedEmployees`,
			),
		);

		return [
			...new Set(visibleAssignments.map((assignment) => assignment.policyId)),
		];
	});
}

function getVisibleChangePolicyAssignmentsForManagerScope<
	T extends ChangePolicyScopeAssignment,
>(
	actor: ChangePolicyScopedActor,
	organizationId: string,
	assignments: T[],
	manageableTeamIds: Set<string> | null,
	managedEmployeeIds: Set<string> | null,
	queryName: string,
) {
	return Effect.gen(function* (_) {
		if (!manageableTeamIds || !managedEmployeeIds) {
			return assignments;
		}

		const teamAssignmentIds = new Set(
			assignments
				.filter((assignment) => assignment.assignmentType === "team" && assignment.teamId)
				.map((assignment) => assignment.teamId as string),
		);
		const employeeAssignmentIds = new Set(
			assignments
				.filter((assignment) => assignment.assignmentType === "employee" && assignment.employeeId)
				.map((assignment) => assignment.employeeId as string),
		);
		const managedEmployees = managedEmployeeIds.size
			? ((yield* _(
					actor.dbService.query(queryName, async () => {
						return await actor.dbService.db.query.employee.findMany({
							where: and(
								eq(employee.organizationId, organizationId),
								eq(employee.isActive, true),
								inArray(employee.id, [...managedEmployeeIds]),
							),
							columns: { id: true, teamId: true },
						});
					}),
				)) as ManagedScopeEmployee[])
			: [];
		const managedEmployeeTeamIds = new Set(
			managedEmployees
				.map((employeeRecord) => employeeRecord.teamId)
				.filter((teamId): teamId is string => Boolean(teamId)),
		);
		const scopedAssignments = assignments.filter((assignment) => {
			if (assignment.assignmentType === "organization") {
				return false;
			}

			if (assignment.assignmentType === "team") {
				return assignment.teamId
					? manageableTeamIds.has(assignment.teamId) || managedEmployeeTeamIds.has(assignment.teamId)
					: false;
			}

			return assignment.employeeId ? managedEmployeeIds.has(assignment.employeeId) : false;
		});

		const orgDefaultIsEffectiveForManagedScope =
			[...manageableTeamIds].some((teamId) => !teamAssignmentIds.has(teamId)) ||
			managedEmployees.some(
				(employeeRecord) =>
					!employeeAssignmentIds.has(employeeRecord.id) &&
					(!employeeRecord.teamId || !teamAssignmentIds.has(employeeRecord.teamId)),
			);

		if (!orgDefaultIsEffectiveForManagedScope) {
			return scopedAssignments;
		}

		const organizationAssignments = assignments.filter(
			(assignment) => assignment.assignmentType === "organization",
		);

		return [...organizationAssignments, ...scopedAssignments];
	});
}

function sortAssignmentsByPriority(assignments: ChangePolicyAssignmentWithDetails[]) {
	return [...assignments].sort((left, right) => {
		if (left.priority !== right.priority) {
			return right.priority - left.priority;
		}

		return right.createdAt.getTime() - left.createdAt.getTime();
	});
}

function requireOrgAdminForChangePolicyMutation(
	actor: ChangePolicyScopedActor,
	resource: string,
	action: string,
	message: string,
) {
	return requireOrgAdminEmployeeSettingsAccess(actor, {
		message,
		resource,
		action,
	});
}

function getPolicyForActiveOrganization(policyId: string, actor: ChangePolicyScopedActor, queryName: string) {
	return actor.dbService.query(queryName, async () => {
		return await actor.dbService.db.query.changePolicy.findFirst({
			where: and(
				eq(changePolicy.id, policyId),
				eq(changePolicy.organizationId, actor.organizationId),
			),
		});
	});
}

// ============================================
// GET POLICIES
// ============================================

export async function getChangePolicies(
	organizationId: string,
): Promise<ServerActionResult<ChangePolicyRecord[]>> {
	const effect = Effect.gen(function* (_) {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* _(
			getScopedChangePolicyAccessContext(organizationId, "getChangePolicies:actor"),
		);
		const visiblePolicyIds = yield* _(
			getVisibleScopedChangePolicyIds(
				actor,
				organizationId,
				manageableTeamIds,
				managedEmployeeIds,
				"getChangePolicies:visibleAssignments",
			),
		);

		if (visiblePolicyIds && visiblePolicyIds.length === 0) {
			return [] satisfies ChangePolicyRecord[];
		}

		const policies = yield* _(
			actor.dbService.query("getChangePolicies", async () => {
				const conditions = [
					eq(changePolicy.organizationId, organizationId),
					eq(changePolicy.isActive, true),
				];

				if (visiblePolicyIds) {
					conditions.push(inArray(changePolicy.id, visiblePolicyIds));
				}

				return await actor.dbService.db.query.changePolicy.findMany({
					where: and(...conditions),
					orderBy: [desc(changePolicy.createdAt)],
				});
			}),
		);

		if (!visiblePolicyIds) {
			return policies;
		}

		return policies.filter((policy) => visiblePolicyIds.includes(policy.id));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getChangePolicy(
	policyId: string,
): Promise<ServerActionResult<ChangePolicyRecord | null>> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ queryName: "getChangePolicy:actor" }),
		)) as ChangePolicyScopedActor;

		if (actor.accessTier === "manager") {
			const { managedEmployeeIds, manageableTeamIds } = yield* _(
				getScopedChangePolicyAccessContext(actor.organizationId, "getChangePolicy:scope"),
			);
			const visiblePolicyIds = yield* _(
				getVisibleScopedChangePolicyIds(
					actor,
					actor.organizationId,
					manageableTeamIds,
					managedEmployeeIds,
					"getChangePolicy:visibleAssignments",
				),
			);

			if (visiblePolicyIds && !visiblePolicyIds.includes(policyId)) {
				return null;
			}
		}

		const policy = yield* _(getPolicyForActiveOrganization(policyId, actor, "getChangePolicy"));

		return policy ?? null;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// CREATE POLICY
// ============================================

export async function createChangePolicy(
	organizationId: string,
	data: CreateChangePolicyInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "createChangePolicy:actor" }),
		)) as ChangePolicyScopedActor;
		yield* _(
			requireOrgAdminForChangePolicyMutation(
				actor,
				"change_policy",
				"create",
				"Only org admins can create change policies",
			),
		);

		if (!data.name || data.name.trim().length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Policy name is required",
						field: "name",
					}),
				),
			);
		}

		if (data.selfServiceDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Self-service days cannot be negative",
						field: "selfServiceDays",
					}),
				),
			);
		}

		if (data.approvalDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Approval days cannot be negative",
						field: "approvalDays",
					}),
				),
			);
		}

		const [policy] = yield* _(
			actor.dbService.query("createChangePolicy", async () => {
				return await actor.dbService.db
					.insert(changePolicy)
					.values({
						organizationId: actor.organizationId,
						name: data.name.trim(),
						description: data.description?.trim(),
						selfServiceDays: data.selfServiceDays,
						approvalDays: data.approvalDays,
						noApprovalRequired: data.noApprovalRequired ?? false,
						notifyAllManagers: data.notifyAllManagers ?? false,
						createdBy: actor.session.user.id,
						updatedAt: new Date(),
					})
					.returning();
			}),
		);

		return { id: policy.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// UPDATE POLICY
// ============================================

export async function updateChangePolicy(
	policyId: string,
	data: UpdateChangePolicyInput,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ queryName: "updateChangePolicy:actor" }),
		)) as ChangePolicyScopedActor;
		yield* _(
			requireOrgAdminForChangePolicyMutation(
				actor,
				"change_policy",
				"update",
				"Only org admins can update change policies",
			),
		);

		const existingPolicy = yield* _(
			getPolicyForActiveOrganization(policyId, actor, "verifyPolicy"),
			Effect.flatMap((value) =>
				value
					? Effect.succeed(value)
					: Effect.fail(
							new NotFoundError({
								message: "Change policy not found",
								entityType: "change_policy",
								entityId: policyId,
							}),
						),
			),
		);

		if (data.name !== undefined && data.name.trim().length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Policy name cannot be empty",
						field: "name",
					}),
				),
			);
		}

		if (data.selfServiceDays !== undefined && data.selfServiceDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Self-service days cannot be negative",
						field: "selfServiceDays",
					}),
				),
			);
		}

		if (data.approvalDays !== undefined && data.approvalDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Approval days cannot be negative",
						field: "approvalDays",
					}),
				),
			);
		}

		yield* _(
			actor.dbService.query("updateChangePolicy", async () => {
				await actor.dbService.db
					.update(changePolicy)
					.set({
						...(data.name !== undefined && { name: data.name.trim() }),
						...(data.description !== undefined && { description: data.description?.trim() }),
						...(data.selfServiceDays !== undefined && { selfServiceDays: data.selfServiceDays }),
						...(data.approvalDays !== undefined && { approvalDays: data.approvalDays }),
						...(data.noApprovalRequired !== undefined && {
							noApprovalRequired: data.noApprovalRequired,
						}),
						...(data.notifyAllManagers !== undefined && {
							notifyAllManagers: data.notifyAllManagers,
						}),
						...(data.isActive !== undefined && { isActive: data.isActive }),
						updatedBy: actor.session.user.id,
					})
					.where(
						and(
							eq(changePolicy.id, existingPolicy.id),
							eq(changePolicy.organizationId, actor.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// DELETE POLICY
// ============================================

export async function deleteChangePolicy(policyId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ queryName: "deleteChangePolicy:actor" }),
		)) as ChangePolicyScopedActor;
		yield* _(
			requireOrgAdminForChangePolicyMutation(
				actor,
				"change_policy",
				"delete",
				"Only org admins can delete change policies",
			),
		);

		yield* _(
			actor.dbService.query("deleteChangePolicy", async () => {
				await actor.dbService.db
					.update(changePolicy)
					.set({ isActive: false, updatedBy: actor.session.user.id })
					.where(
						and(
							eq(changePolicy.id, policyId),
							eq(changePolicy.organizationId, actor.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// ASSIGNMENTS
// ============================================

export async function getChangePolicyAssignments(
	organizationId: string,
): Promise<ServerActionResult<ChangePolicyAssignmentWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* _(
			getScopedChangePolicyAccessContext(organizationId, "getChangePolicyAssignments:actor"),
		);
		const assignments = (yield* _(
			actor.dbService.query("getChangePolicyAssignments", async () => {
				return await actor.dbService.db.query.changePolicyAssignment.findMany({
					where: and(
						eq(changePolicyAssignment.organizationId, organizationId),
						eq(changePolicyAssignment.isActive, true),
					),
					with: {
						policy: {
							columns: {
								id: true,
								name: true,
								selfServiceDays: true,
								approvalDays: true,
								noApprovalRequired: true,
							},
						},
						team: {
							columns: { id: true, name: true },
						},
						employee: {
							columns: { id: true, firstName: true, lastName: true },
						},
					},
					orderBy: [desc(changePolicyAssignment.priority), desc(changePolicyAssignment.createdAt)],
				});
			}),
		)) as ChangePolicyAssignmentWithDetails[];
		const visibleAssignments = yield* _(
			getVisibleChangePolicyAssignmentsForManagerScope(
				actor,
				organizationId,
				assignments,
				manageableTeamIds,
				managedEmployeeIds,
				"getChangePolicyAssignments:managedEmployees",
			),
		);

		return sortAssignmentsByPriority(
			visibleAssignments as ChangePolicyAssignmentWithDetails[],
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function createChangePolicyAssignment(
	organizationId: string,
	data: CreateAssignmentInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "createChangePolicyAssignment:actor",
			}),
		)) as ChangePolicyScopedActor;
		yield* _(
			requireOrgAdminForChangePolicyMutation(
				actor,
				"change_policy_assignment",
				"create",
				"Only org admins can create change policy assignments",
			),
		);

		if (data.assignmentType === "team" && !data.teamId) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Team ID is required for team assignments",
						field: "teamId",
					}),
				),
			);
		}

		if (data.assignmentType === "employee" && !data.employeeId) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Employee ID is required for employee assignments",
						field: "employeeId",
					}),
				),
			);
		}

		const priority =
			data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

		const [assignment] = yield* _(
			actor.dbService.query("createChangePolicyAssignment", async () => {
				return await actor.dbService.db
					.insert(changePolicyAssignment)
					.values({
						policyId: data.policyId,
						organizationId: actor.organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId ?? null,
						employeeId: data.employeeId ?? null,
						priority,
						effectiveFrom: data.effectiveFrom,
						effectiveUntil: data.effectiveUntil,
						isActive: true,
						createdBy: actor.session.user.id,
						updatedAt: new Date(),
					})
					.returning();
			}),
		);

		return { id: assignment.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function deleteChangePolicyAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ queryName: "deleteChangePolicyAssignment:actor" }),
		)) as ChangePolicyScopedActor;
		yield* _(
			requireOrgAdminForChangePolicyMutation(
				actor,
				"change_policy_assignment",
				"delete",
				"Only org admins can delete change policy assignments",
			),
		);

		yield* _(
			actor.dbService.query("deleteChangePolicyAssignment", async () => {
				await actor.dbService.db
					.update(changePolicyAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(changePolicyAssignment.id, assignmentId),
							eq(changePolicyAssignment.organizationId, actor.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// HELPER QUERIES
// ============================================

export async function getTeamsForAssignment(
	organizationId: string,
): Promise<ServerActionResult<{ id: string; name: string }[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getTeamsForAssignment:actor" }),
		)) as ChangePolicyScopedActor;
		yield* _(
			requireOrgAdminForChangePolicyMutation(
				actor,
				"change_policy_assignment",
				"read_assignment_teams",
				"Only org admins can load change policy team assignments",
			),
		);

		const teams = yield* _(
			actor.dbService.query("getTeamsForAssignment", async () => {
				return await actor.dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: [team.name],
				});
			}),
		);

		return teams;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getEmployeesForAssignment(
	organizationId: string,
): Promise<
	ServerActionResult<{ id: string; firstName: string | null; lastName: string | null }[]>
> {
	const effect = Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "getEmployeesForAssignment:actor",
			}),
		)) as ChangePolicyScopedActor;
		yield* _(
			requireOrgAdminForChangePolicyMutation(
				actor,
				"change_policy_assignment",
				"read_assignment_employees",
				"Only org admins can load change policy employee assignments",
			),
		);

		const employees = yield* _(
			actor.dbService.query("getEmployeesForAssignment", async () => {
				return await actor.dbService.db.query.employee.findMany({
					where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
					columns: { id: true, firstName: true, lastName: true },
					orderBy: [employee.lastName, employee.firstName],
				});
			}),
		);

		return employees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
