"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { changePolicy, changePolicyAssignment, employee, team, teamPermissions } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	findEmployeesNotOnCurrentRoster,
	formerEmployeeRefusal,
} from "@/lib/employee-lifecycle/current-roster-guard";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction/ranks";

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
		user?: { firstName: string | null; lastName: string | null } | null;
	} | null;
};

const dayCount = (message: string) => z.number().int().min(0, message);

const createChangePolicySchema = z.strictObject({
	name: z.string().trim().min(1, "Policy name is required"),
	description: z.string().optional(),
	selfServiceDays: dayCount("Self-service days cannot be negative"),
	approvalDays: dayCount("Approval days cannot be negative"),
	noApprovalRequired: z.boolean().optional(),
	notifyAllManagers: z.boolean().optional(),
});

const updateChangePolicySchema = z.strictObject({
	policyId: z.string().min(1),
	data: z.strictObject({
		name: z.string().trim().min(1, "Policy name cannot be empty").optional(),
		description: z.string().optional(),
		selfServiceDays: dayCount("Self-service days cannot be negative").optional(),
		approvalDays: dayCount("Approval days cannot be negative").optional(),
		noApprovalRequired: z.boolean().optional(),
		notifyAllManagers: z.boolean().optional(),
		isActive: z.boolean().optional(),
	}),
});

const createAssignmentSchema = z
	.strictObject({
		policyId: z.string().min(1),
		assignmentType: z.enum(["organization", "team", "employee"]),
		teamId: z.string().optional(),
		employeeId: z.string().optional(),
		effectiveFrom: z.date().optional(),
		effectiveUntil: z.date().optional(),
	})
	.superRefine((input, context) => {
		if (input.assignmentType === "team" && !input.teamId) {
			context.addIssue({
				code: "custom",
				message: "Team ID is required for team assignments",
				path: ["teamId"],
			});
		}
		if (input.assignmentType === "employee" && !input.employeeId) {
			context.addIssue({
				code: "custom",
				message: "Employee ID is required for employee assignments",
				path: ["employeeId"],
			});
		}
	});

export type CreateChangePolicyInput = z.input<typeof createChangePolicySchema>;
export type UpdateChangePolicyInput = z.input<typeof updateChangePolicySchema>["data"];
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;

const idSchema = z.string().min(1);

type ChangePolicyScopeAssignment = {
	policyId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
};

/** Whom a scoped manager sees change policies for; null fields for an org admin. */
type ChangePolicyScope = {
	managedEmployeeIds: ReadonlySet<string> | null;
	/** Teams whose settings the manager may manage. */
	manageableTeamIds: ReadonlySet<string> | null;
};

function changePolicyScopeOf(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		const scope = yield* actor.managedScope();
		if (scope.organizationWide) {
			return { managedEmployeeIds: null, manageableTeamIds: null } satisfies ChangePolicyScope;
		}
		const dbService = yield* DatabaseService;
		const managerId = actor.employee?.id;
		const teamPermissionRows = managerId
			? yield* dbService.query("changePolicies.scope.teamPermissions", () =>
					dbService.db.query.teamPermissions.findMany({
						where: and(
							eq(teamPermissions.employeeId, managerId),
							eq(teamPermissions.organizationId, organizationId),
						),
						columns: { teamId: true, canManageTeamSettings: true },
					}),
				)
			: [];
		return {
			managedEmployeeIds: scope.employeeIds,
			manageableTeamIds: new Set(
				teamPermissionRows.flatMap((permission) =>
					permission.canManageTeamSettings && permission.teamId ? [permission.teamId] : [],
				),
			),
		} satisfies ChangePolicyScope;
	});
}

function visibleScopedChangePolicyIds(organizationId: string, scope: ChangePolicyScope) {
	return Effect.gen(function* () {
		if (!scope.manageableTeamIds || !scope.managedEmployeeIds) {
			return null;
		}
		const dbService = yield* DatabaseService;
		const assignmentRows = yield* dbService.query("changePolicies.scope.assignments", () =>
			dbService.db.query.changePolicyAssignment.findMany({
				where: and(
					eq(changePolicyAssignment.organizationId, organizationId),
					eq(changePolicyAssignment.isActive, true),
				),
				columns: { policyId: true, assignmentType: true, teamId: true, employeeId: true },
			}),
		);
		const visibleAssignments = yield* assignmentsInManagerScope(
			organizationId,
			assignmentRows,
			scope,
		);
		return [...new Set(visibleAssignments.map((assignment) => assignment.policyId))];
	});
}

function assignmentsInManagerScope<T extends ChangePolicyScopeAssignment>(
	organizationId: string,
	assignments: T[],
	scope: ChangePolicyScope,
) {
	return Effect.gen(function* () {
		const { manageableTeamIds, managedEmployeeIds } = scope;
		if (!manageableTeamIds || !managedEmployeeIds) {
			return assignments;
		}

		const teamAssignmentIds = new Set(
			assignments.flatMap((assignment) =>
				assignment.assignmentType === "team" && assignment.teamId ? [assignment.teamId] : [],
			),
		);
		const employeeAssignmentIds = new Set(
			assignments.flatMap((assignment) =>
				assignment.assignmentType === "employee" && assignment.employeeId
					? [assignment.employeeId]
					: [],
			),
		);
		const dbService = yield* DatabaseService;
		const managedEmployees = managedEmployeeIds.size
			? yield* dbService.query("changePolicies.scope.managedEmployees", () =>
					dbService.db.query.employee.findMany({
						where: and(
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
							inArray(employee.id, [...managedEmployeeIds]),
						),
						columns: { id: true, teamId: true },
					}),
				)
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
					? manageableTeamIds.has(assignment.teamId) ||
							managedEmployeeTeamIds.has(assignment.teamId)
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
	return assignments.toSorted((left, right) => {
		if (left.priority !== right.priority) {
			return right.priority - left.priority;
		}

		return right.createdAt.getTime() - left.createdAt.getTime();
	});
}

function findPolicy(policyId: string, organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("changePolicies.findPolicy", () =>
			dbService.db.query.changePolicy.findFirst({
				where: and(eq(changePolicy.id, policyId), eq(changePolicy.organizationId, organizationId)),
			}),
		);
	});
}

// ============================================
// GET POLICIES
// ============================================

export const getChangePolicies = organizationAction(
	{ name: "changePolicies.list", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* changePolicyScopeOf(actor, organizationId);
			const visiblePolicyIds = yield* visibleScopedChangePolicyIds(organizationId, scope);

			if (visiblePolicyIds && visiblePolicyIds.length === 0) {
				return [] satisfies ChangePolicyRecord[];
			}

			const dbService = yield* DatabaseService;
			const policies: ChangePolicyRecord[] = yield* dbService.query("getChangePolicies", () => {
				const conditions = [
					eq(changePolicy.organizationId, organizationId),
					eq(changePolicy.isActive, true),
				];

				if (visiblePolicyIds) {
					conditions.push(inArray(changePolicy.id, visiblePolicyIds));
				}

				return dbService.db.query.changePolicy.findMany({
					where: and(...conditions),
					orderBy: [desc(changePolicy.createdAt)],
				});
			});

			if (!visiblePolicyIds) {
				return policies;
			}

			const visiblePolicyIdSet = new Set(visiblePolicyIds);
			return policies.filter((policy) => visiblePolicyIdSet.has(policy.id));
		}),
);

export const getChangePolicy = organizationAction(
	{ name: "changePolicies.get", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: policyId }) =>
		Effect.gen(function* () {
			const scope = yield* changePolicyScopeOf(actor, organizationId);
			const visiblePolicyIds = yield* visibleScopedChangePolicyIds(organizationId, scope);

			if (visiblePolicyIds && !visiblePolicyIds.includes(policyId)) {
				return null;
			}

			const policy = yield* findPolicy(policyId, organizationId);
			return policy ?? null;
		}),
);

// ============================================
// CREATE POLICY
// ============================================

export const createChangePolicy = organizationAction(
	{ name: "changePolicies.create", requires: "orgAdmin", schema: createChangePolicySchema },
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [policy] = yield* dbService.query("createChangePolicy", () =>
				withOrganizationConfigurationMutation(dbService.db, organizationId, (tx) =>
					tx
						.insert(changePolicy)
						.values({
							organizationId,
							name: data.name,
							description: data.description?.trim(),
							selfServiceDays: data.selfServiceDays,
							approvalDays: data.approvalDays,
							noApprovalRequired: data.noApprovalRequired ?? false,
							notifyAllManagers: data.notifyAllManagers ?? false,
							createdBy: actor.userId,
							updatedAt: new Date(),
						})
						.returning(),
				),
			);

			return { id: policy.id };
		}),
);

// ============================================
// UPDATE POLICY
// ============================================

export const updateChangePolicy = organizationAction(
	{ name: "changePolicies.update", requires: "orgAdmin", schema: updateChangePolicySchema },
	({ actor, organizationId, input: { policyId, data } }) =>
		Effect.gen(function* () {
			const existingPolicy = yield* findPolicy(policyId, organizationId);
			if (!existingPolicy) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Change policy not found",
						entityType: "change_policy",
						entityId: policyId,
					}),
				);
			}

			const dbService = yield* DatabaseService;
			yield* dbService.query("updateChangePolicy", () =>
				withOrganizationConfigurationMutation(dbService.db, organizationId, (tx) =>
					tx
						.update(changePolicy)
						.set({
							...(data.name !== undefined && { name: data.name }),
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
							updatedBy: actor.userId,
						})
						.where(
							and(
								eq(changePolicy.id, existingPolicy.id),
								eq(changePolicy.organizationId, organizationId),
							),
						),
				),
			);
		}),
);

// ============================================
// DELETE POLICY
// ============================================

export const deleteChangePolicy = organizationAction(
	{ name: "changePolicies.delete", requires: "orgAdmin", schema: idSchema },
	({ actor, organizationId, input: policyId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("deleteChangePolicy", () =>
				withOrganizationConfigurationMutation(dbService.db, organizationId, (tx) =>
					tx
						.update(changePolicy)
						.set({ isActive: false, updatedBy: actor.userId })
						.where(
							and(eq(changePolicy.id, policyId), eq(changePolicy.organizationId, organizationId)),
						),
				),
			);
		}),
);

// ============================================
// ASSIGNMENTS
// ============================================

export const getChangePolicyAssignments = organizationAction(
	{ name: "changePolicies.listAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* changePolicyScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;
			const assignments = yield* dbService.query("getChangePolicyAssignments", () =>
				dbService.db.query.changePolicyAssignment.findMany({
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
							columns: { id: true },
							with: { user: { columns: { firstName: true, lastName: true } } },
						},
					},
					orderBy: [desc(changePolicyAssignment.priority), desc(changePolicyAssignment.createdAt)],
				}),
			);
			const assignmentsWithAuthNames = assignments.map((assignment) => ({
				...assignment,
				employee: assignment.employee
					? {
							id: assignment.employee.id,
							firstName: assignment.employee.user?.firstName ?? null,
							lastName: assignment.employee.user?.lastName ?? null,
							user: assignment.employee.user,
						}
					: null,
			})) satisfies ChangePolicyAssignmentWithDetails[];
			const visibleAssignments = yield* assignmentsInManagerScope(
				organizationId,
				assignmentsWithAuthNames,
				scope,
			);

			return sortAssignmentsByPriority(visibleAssignments);
		}),
);

export const createChangePolicyAssignment = organizationAction(
	{
		name: "changePolicies.createAssignment",
		requires: "orgAdmin",
		schema: createAssignmentSchema,
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			const priority =
				data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;
			const dbService = yield* DatabaseService;

			// The policy and its target must be this organization's; manual submissions
			// read effective assignments under the configuration guard.
			const created = yield* dbService.query("createChangePolicyAssignment", () =>
				withOrganizationConfigurationMutation(dbService.db, organizationId, async (tx) => {
					const [policy] = await tx
						.select({ id: changePolicy.id })
						.from(changePolicy)
						.where(
							and(eq(changePolicy.id, data.policyId), eq(changePolicy.organizationId, organizationId)),
						)
						.limit(1);
					if (!policy) return { invalid: "policyId" as const };
					if (data.teamId) {
						const [assignedTeam] = await tx
							.select({ id: team.id })
							.from(team)
							.where(and(eq(team.id, data.teamId), eq(team.organizationId, organizationId)))
							.limit(1);
						if (!assignedTeam) return { invalid: "teamId" as const };
					}
					if (data.employeeId) {
						// A former employee gets no new change policy assignment (#1438), also
						// when they leave between the roster check and this write.
						const former = await findEmployeesNotOnCurrentRoster(tx, {
							organizationId,
							employeeIds: [data.employeeId],
						});
						if (former.length > 0) return { former };
					}

					const [assignment] = await tx
						.insert(changePolicyAssignment)
						.values({
							policyId: data.policyId,
							organizationId,
							assignmentType: data.assignmentType,
							teamId: data.teamId ?? null,
							employeeId: data.employeeId ?? null,
							priority,
							effectiveFrom: data.effectiveFrom,
							effectiveUntil: data.effectiveUntil,
							isActive: true,
							createdBy: actor.userId,
							updatedAt: new Date(),
						})
						.returning({ id: changePolicyAssignment.id });
					return { id: assignment.id };
				}),
			);

			if ("invalid" in created) {
				return yield* Effect.fail(
					new ValidationError({
						message: "The policy and the assignment target must belong to this organization",
						field: created.invalid,
					}),
				);
			}
			if ("former" in created) {
				return yield* Effect.fail(formerEmployeeRefusal({ field: "employeeId" }, created.former ?? []));
			}

			return { id: created.id };
		}),
);

export const deleteChangePolicyAssignment = organizationAction(
	{ name: "changePolicies.deleteAssignment", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("deleteChangePolicyAssignment", () =>
				withOrganizationConfigurationMutation(dbService.db, organizationId, (tx) =>
					tx
						.update(changePolicyAssignment)
						.set({ isActive: false })
						.where(
							and(
								eq(changePolicyAssignment.id, assignmentId),
								eq(changePolicyAssignment.organizationId, organizationId),
							),
						),
				),
			);
		}),
);

// ============================================
// HELPER QUERIES
// ============================================

export const getTeamsForAssignment = organizationAction(
	{ name: "changePolicies.assignmentTeams", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("getTeamsForAssignment", () =>
				dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: [team.name],
				}),
			);
		}),
);

export const getEmployeesForAssignment = organizationAction(
	{ name: "changePolicies.assignmentEmployees", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("getEmployeesForAssignment", async () => {
				const rows = await dbService.db.query.employee.findMany({
					where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
					columns: { id: true },
					with: { user: { columns: { firstName: true, lastName: true } } },
					orderBy: (employeeRecord, { asc }) => [asc(employeeRecord.id)],
				});

				return rows.map((employeeRecord) => ({
					id: employeeRecord.id,
					firstName: employeeRecord.user?.firstName ?? null,
					lastName: employeeRecord.user?.lastName ?? null,
				}));
			});
		}),
);
