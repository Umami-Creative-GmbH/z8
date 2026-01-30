import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { Context, Effect, Layer } from "effect";
import {
	changePolicy,
	changePolicyAssignment,
	type changePolicy as ChangePolicyTable,
	type changePolicyAssignment as ChangePolicyAssignmentTable,
	employee,
	employeeManagers,
} from "@/db/schema";
import type { DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

// Type definitions
type ChangePolicy = typeof ChangePolicyTable.$inferSelect;
type ChangePolicyAssignment = typeof ChangePolicyAssignmentTable.$inferSelect;

/**
 * Resolved policy with assignment context
 */
export interface ResolvedChangePolicy {
	policyId: string;
	policyName: string;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired: boolean;
	notifyAllManagers: boolean;
	assignmentLevel: "organization" | "team" | "employee";
	assignmentId: string;
}

/**
 * Edit capability result - determines what the user can do
 */
export type EditCapability =
	| { type: "direct"; reason: "within_self_service" | "no_policy" | "trust_mode" }
	| { type: "approval_required"; reason: "within_approval_window" | "zero_day_policy" }
	| { type: "forbidden"; reason: "beyond_approval_window"; daysBack: number };

/**
 * Input for creating a new change policy
 */
export interface CreatePolicyInput {
	organizationId: string;
	name: string;
	description?: string;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired?: boolean;
	notifyAllManagers?: boolean;
	createdBy: string;
}

/**
 * Input for updating a change policy
 */
export interface UpdatePolicyInput {
	name?: string;
	description?: string;
	selfServiceDays?: number;
	approvalDays?: number;
	noApprovalRequired?: boolean;
	notifyAllManagers?: boolean;
	isActive?: boolean;
	updatedBy: string;
}

/**
 * Input for assigning a policy
 */
export interface AssignPolicyInput {
	policyId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
	effectiveFrom?: Date;
	effectiveUntil?: Date;
	createdBy: string;
}

/**
 * Manager information for notification
 */
export interface ManagerInfo {
	managerId: string;
	userId: string;
	name: string;
	isPrimary: boolean;
}

export class ChangePolicyService extends Context.Tag("ChangePolicyService")<
	ChangePolicyService,
	{
		/**
		 * Resolve the effective policy for an employee.
		 * Resolution order: employee-specific > team > organization
		 * Returns null if no policy is assigned (= no restrictions)
		 */
		readonly resolvePolicy: (
			employeeId: string,
			timestamp?: Date,
		) => Effect.Effect<ResolvedChangePolicy | null, DatabaseError>;

		/**
		 * Determine what edit capability the user has for a work period.
		 * Considers the policy, work period age, and user role.
		 */
		readonly getEditCapability: (params: {
			employeeId: string;
			workPeriodEndTime: Date;
			timezone: string;
			currentTime?: Date;
		}) => Effect.Effect<EditCapability, DatabaseError>;

		/**
		 * Check if clock-out needs approval (for 0-day policy)
		 */
		readonly checkClockOutNeedsApproval: (
			employeeId: string,
		) => Effect.Effect<boolean, DatabaseError>;

		/**
		 * Get managers to notify for an approval request.
		 * Respects the notifyAllManagers policy setting.
		 */
		readonly getManagersForApproval: (
			employeeId: string,
			notifyAll: boolean,
		) => Effect.Effect<ManagerInfo[], DatabaseError>;

		// CRUD operations
		readonly createPolicy: (
			input: CreatePolicyInput,
		) => Effect.Effect<ChangePolicy, ValidationError | DatabaseError>;

		readonly updatePolicy: (
			id: string,
			input: UpdatePolicyInput,
		) => Effect.Effect<ChangePolicy, NotFoundError | ValidationError | DatabaseError>;

		readonly deletePolicy: (id: string) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly getPolicies: (organizationId: string) => Effect.Effect<ChangePolicy[], DatabaseError>;

		readonly getPolicyById: (id: string) => Effect.Effect<ChangePolicy | null, DatabaseError>;

		readonly assignPolicy: (
			input: AssignPolicyInput,
		) => Effect.Effect<ChangePolicyAssignment, ValidationError | DatabaseError>;

		readonly unassignPolicy: (
			assignmentId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly getAssignments: (organizationId: string) => Effect.Effect<
			Array<
				ChangePolicyAssignment & {
					policy: ChangePolicy;
					team?: { id: string; name: string } | null;
					employee?: { id: string; firstName: string | null; lastName: string | null } | null;
				}
			>,
			DatabaseError
		>;
	}
>() {}

export const ChangePolicyServiceLive = Layer.effect(
	ChangePolicyService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		/**
		 * Calculate the age of a work period in days, accounting for timezone
		 */
		const calculateDaysBack = (
			workPeriodEndTime: Date,
			timezone: string,
			currentTime: Date = new Date(),
		): number => {
			const workPeriodDate = DateTime.fromJSDate(workPeriodEndTime, { zone: timezone }).startOf(
				"day",
			);
			const currentDate = DateTime.fromJSDate(currentTime, { zone: timezone }).startOf("day");
			return Math.floor(currentDate.diff(workPeriodDate, "days").days);
		};

		// Helper function to resolve policy - extracted so it can be called internally
		const resolvePolicyImpl = (
			employeeId: string,
			timestamp: Date = new Date(),
		): Effect.Effect<ResolvedChangePolicy | null, DatabaseError> =>
			Effect.gen(function* (_) {
				// Get employee with team info
				const emp = yield* _(
					dbService.query("getEmployeeForPolicy", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.id, employeeId),
							columns: {
								id: true,
								teamId: true,
								organizationId: true,
							},
						});
					}),
				);

				if (!emp) {
					return null;
				}

				// Build conditions for temporal validity
				const now = timestamp;
				const temporalConditions = and(
					eq(changePolicyAssignment.isActive, true),
					or(
						isNull(changePolicyAssignment.effectiveFrom),
						lte(changePolicyAssignment.effectiveFrom, now),
					),
					or(isNull(changePolicyAssignment.effectiveUntil)),
				);

				// 1. Check for employee-specific assignment (priority 2)
				const employeeAssignment = yield* _(
					dbService.query("getEmployeePolicyAssignment", async () => {
						return await dbService.db.query.changePolicyAssignment.findFirst({
							where: and(
								eq(changePolicyAssignment.employeeId, employeeId),
								eq(changePolicyAssignment.assignmentType, "employee"),
								temporalConditions,
							),
							with: {
								policy: true,
							},
						});
					}),
				);

				if (employeeAssignment?.policy?.isActive) {
					return {
						policyId: employeeAssignment.policy.id,
						policyName: employeeAssignment.policy.name,
						selfServiceDays: employeeAssignment.policy.selfServiceDays,
						approvalDays: employeeAssignment.policy.approvalDays,
						noApprovalRequired: employeeAssignment.policy.noApprovalRequired,
						notifyAllManagers: employeeAssignment.policy.notifyAllManagers,
						assignmentLevel: "employee" as const,
						assignmentId: employeeAssignment.id,
					};
				}

				// 2. Check for team assignment (priority 1)
				if (emp.teamId) {
					const teamAssignment = yield* _(
						dbService.query("getTeamPolicyAssignment", async () => {
							return await dbService.db.query.changePolicyAssignment.findFirst({
								where: and(
									eq(changePolicyAssignment.teamId, emp.teamId!),
									eq(changePolicyAssignment.assignmentType, "team"),
									temporalConditions,
								),
								with: {
									policy: true,
								},
							});
						}),
					);

					if (teamAssignment?.policy?.isActive) {
						return {
							policyId: teamAssignment.policy.id,
							policyName: teamAssignment.policy.name,
							selfServiceDays: teamAssignment.policy.selfServiceDays,
							approvalDays: teamAssignment.policy.approvalDays,
							noApprovalRequired: teamAssignment.policy.noApprovalRequired,
							notifyAllManagers: teamAssignment.policy.notifyAllManagers,
							assignmentLevel: "team" as const,
							assignmentId: teamAssignment.id,
						};
					}
				}

				// 3. Check for organization assignment (priority 0)
				const orgAssignment = yield* _(
					dbService.query("getOrgPolicyAssignment", async () => {
						return await dbService.db.query.changePolicyAssignment.findFirst({
							where: and(
								eq(changePolicyAssignment.organizationId, emp.organizationId),
								eq(changePolicyAssignment.assignmentType, "organization"),
								temporalConditions,
							),
							with: {
								policy: true,
							},
						});
					}),
				);

				if (orgAssignment?.policy?.isActive) {
					return {
						policyId: orgAssignment.policy.id,
						policyName: orgAssignment.policy.name,
						selfServiceDays: orgAssignment.policy.selfServiceDays,
						approvalDays: orgAssignment.policy.approvalDays,
						noApprovalRequired: orgAssignment.policy.noApprovalRequired,
						notifyAllManagers: orgAssignment.policy.notifyAllManagers,
						assignmentLevel: "organization" as const,
						assignmentId: orgAssignment.id,
					};
				}

				// No policy found = no restrictions
				return null;
			});

		return ChangePolicyService.of({
			resolvePolicy: resolvePolicyImpl,

			getEditCapability: ({ employeeId, workPeriodEndTime, timezone, currentTime }) =>
				Effect.gen(function* (_) {
					// Use the helper function directly instead of ChangePolicyService.pipe()
					const policy = yield* _(resolvePolicyImpl(employeeId, currentTime));

					// No policy = no restrictions, allow direct edit
					if (!policy) {
						return { type: "direct" as const, reason: "no_policy" as const };
					}

					// Trust mode = no approval required
					if (policy.noApprovalRequired) {
						return { type: "direct" as const, reason: "trust_mode" as const };
					}

					const daysBack = calculateDaysBack(
						workPeriodEndTime,
						timezone,
						currentTime ?? new Date(),
					);

					// Within self-service window (including same day when selfServiceDays=0)
					if (daysBack <= policy.selfServiceDays) {
						return { type: "direct" as const, reason: "within_self_service" as const };
					}

					// Within approval window
					const totalApprovalWindow = policy.selfServiceDays + policy.approvalDays;
					if (daysBack <= totalApprovalWindow) {
						return {
							type: "approval_required" as const,
							reason: "within_approval_window" as const,
						};
					}

					// Beyond approval window - forbidden for employees
					return {
						type: "forbidden" as const,
						reason: "beyond_approval_window" as const,
						daysBack,
					};
				}),

			checkClockOutNeedsApproval: (employeeId) =>
				Effect.gen(function* (_) {
					// Use the helper function directly instead of ChangePolicyService.pipe()
					const policy = yield* _(resolvePolicyImpl(employeeId));

					// No policy = no approval needed
					if (!policy) {
						return false;
					}

					// Trust mode = no approval needed
					if (policy.noApprovalRequired) {
						return false;
					}

					// 0-day policy: selfServiceDays=0 AND approvalDays=0 means every clock-out triggers approval
					// But if approvalDays > 0, same-day is self-service
					// Actually, the 0-day policy scenario is when selfServiceDays=0 and we want clock-out approval
					// Let's interpret: if selfServiceDays=0 AND approvalDays >= 0, clock-out needs approval
					// because even same-day edits require approval when selfServiceDays=0

					// For 0-day policy where clock-out itself requires approval:
					// selfServiceDays=0 means same-day changes need approval
					// This creates immediate approval trigger on clock-out
					return policy.selfServiceDays === 0;
				}),

			getManagersForApproval: (employeeId, notifyAll) =>
				Effect.gen(function* (_) {
					const managers = yield* _(
						dbService.query("getManagersForApproval", async () => {
							if (notifyAll) {
								// Get all managers
								const result = await dbService.db.query.employeeManagers.findMany({
									where: eq(employeeManagers.employeeId, employeeId),
									with: {
										manager: {
											columns: {
												id: true,
												userId: true,
												firstName: true,
												lastName: true,
											},
										},
									},
								});

								return result
									.filter((r) => r.manager)
									.map((r) => ({
										managerId: r.manager.id,
										userId: r.manager.userId,
										name:
											[r.manager.firstName, r.manager.lastName].filter(Boolean).join(" ") ||
											"Manager",
										isPrimary: r.isPrimary,
									}));
							} else {
								// Get only primary manager
								const result = await dbService.db.query.employeeManagers.findFirst({
									where: and(
										eq(employeeManagers.employeeId, employeeId),
										eq(employeeManagers.isPrimary, true),
									),
									with: {
										manager: {
											columns: {
												id: true,
												userId: true,
												firstName: true,
												lastName: true,
											},
										},
									},
								});

								if (!result?.manager) {
									// Fallback: get any manager
									const fallback = await dbService.db.query.employeeManagers.findFirst({
										where: eq(employeeManagers.employeeId, employeeId),
										with: {
											manager: {
												columns: {
													id: true,
													userId: true,
													firstName: true,
													lastName: true,
												},
											},
										},
									});

									if (!fallback?.manager) return [];

									return [
										{
											managerId: fallback.manager.id,
											userId: fallback.manager.userId,
											name:
												[fallback.manager.firstName, fallback.manager.lastName]
													.filter(Boolean)
													.join(" ") || "Manager",
											isPrimary: fallback.isPrimary,
										},
									];
								}

								return [
									{
										managerId: result.manager.id,
										userId: result.manager.userId,
										name:
											[result.manager.firstName, result.manager.lastName]
												.filter(Boolean)
												.join(" ") || "Manager",
										isPrimary: result.isPrimary,
									},
								];
							}
						}),
					);

					return managers;
				}),

			// CRUD operations
			createPolicy: (input) =>
				Effect.gen(function* (_) {
					const created = yield* _(
						dbService.query("createChangePolicy", async () => {
							const [policy] = await dbService.db
								.insert(changePolicy)
								.values({
									organizationId: input.organizationId,
									name: input.name,
									description: input.description,
									selfServiceDays: input.selfServiceDays,
									approvalDays: input.approvalDays,
									noApprovalRequired: input.noApprovalRequired ?? false,
									notifyAllManagers: input.notifyAllManagers ?? false,
									createdBy: input.createdBy,
									updatedAt: new Date(),
								})
								.returning();
							return policy;
						}),
					);

					return created;
				}),

			updatePolicy: (id, input) =>
				Effect.gen(function* (_) {
					const updated = yield* _(
						dbService.query("updateChangePolicy", async () => {
							const [policy] = await dbService.db
								.update(changePolicy)
								.set({
									...(input.name !== undefined && { name: input.name }),
									...(input.description !== undefined && { description: input.description }),
									...(input.selfServiceDays !== undefined && {
										selfServiceDays: input.selfServiceDays,
									}),
									...(input.approvalDays !== undefined && { approvalDays: input.approvalDays }),
									...(input.noApprovalRequired !== undefined && {
										noApprovalRequired: input.noApprovalRequired,
									}),
									...(input.notifyAllManagers !== undefined && {
										notifyAllManagers: input.notifyAllManagers,
									}),
									...(input.isActive !== undefined && { isActive: input.isActive }),
									updatedBy: input.updatedBy,
								})
								.where(eq(changePolicy.id, id))
								.returning();
							return policy;
						}),
					);

					return updated;
				}),

			deletePolicy: (id) =>
				Effect.gen(function* (_) {
					// Soft delete
					yield* _(
						dbService.query("softDeleteChangePolicy", async () => {
							await dbService.db
								.update(changePolicy)
								.set({ isActive: false })
								.where(eq(changePolicy.id, id));
						}),
					);
				}),

			getPolicies: (organizationId) =>
				Effect.gen(function* (_) {
					const policies = yield* _(
						dbService.query("getChangePolicies", async () => {
							return await dbService.db.query.changePolicy.findMany({
								where: and(
									eq(changePolicy.organizationId, organizationId),
									eq(changePolicy.isActive, true),
								),
								orderBy: [desc(changePolicy.createdAt)],
							});
						}),
					);

					return policies;
				}),

			getPolicyById: (id) =>
				Effect.gen(function* (_) {
					const policy = yield* _(
						dbService.query("getChangePolicyById", async () => {
							return await dbService.db.query.changePolicy.findFirst({
								where: eq(changePolicy.id, id),
							});
						}),
					);

					return policy ?? null;
				}),

			assignPolicy: (input) =>
				Effect.gen(function* (_) {
					// Calculate priority based on assignment type
					const priority =
						input.assignmentType === "employee" ? 2 : input.assignmentType === "team" ? 1 : 0;

					const created = yield* _(
						dbService.query("assignChangePolicy", async () => {
							const [assignment] = await dbService.db
								.insert(changePolicyAssignment)
								.values({
									policyId: input.policyId,
									organizationId: input.organizationId,
									assignmentType: input.assignmentType,
									teamId: input.teamId,
									employeeId: input.employeeId,
									priority,
									effectiveFrom: input.effectiveFrom,
									effectiveUntil: input.effectiveUntil,
									createdBy: input.createdBy,
									updatedAt: new Date(),
								})
								.returning();
							return assignment;
						}),
					);

					return created;
				}),

			unassignPolicy: (assignmentId) =>
				Effect.gen(function* (_) {
					// Soft delete
					yield* _(
						dbService.query("unassignChangePolicy", async () => {
							await dbService.db
								.update(changePolicyAssignment)
								.set({ isActive: false })
								.where(eq(changePolicyAssignment.id, assignmentId));
						}),
					);
				}),

			getAssignments: (organizationId) =>
				Effect.gen(function* (_) {
					const assignments = yield* _(
						dbService.query("getChangePolicyAssignments", async () => {
							return await dbService.db.query.changePolicyAssignment.findMany({
								where: and(
									eq(changePolicyAssignment.organizationId, organizationId),
									eq(changePolicyAssignment.isActive, true),
								),
								with: {
									policy: true,
									team: {
										columns: {
											id: true,
											name: true,
										},
									},
									employee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
								},
								orderBy: [
									desc(changePolicyAssignment.priority),
									desc(changePolicyAssignment.createdAt),
								],
							});
						}),
					);

					return assignments;
				}),
		});
	}),
);
