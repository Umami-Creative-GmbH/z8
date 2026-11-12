"use server";

import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, team, vacationAllowance, vacationPolicyAssignment } from "@/db/schema";
import {
	endVacationPolicyAssignment,
	loadVacationPolicyHistoryContext,
	vacationPolicyWriteFailure,
	writeVacationPolicyAssignment,
} from "@/lib/absences/vacation-policy-assignment-write";
import { loadEmployeeVacationPolicy } from "@/lib/absences/vacation-policy-history";
import { DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { findManagedEmployee } from "./managed-employee";

// ============================================
// INPUT SCHEMAS
// ============================================

const assignmentDatesSchema = {
	effectiveFrom: z.string().optional(),
	effectiveUntil: z.string().optional(),
	reviewedBackdate: z.boolean().optional(),
};

const createAssignmentSchema = z
	.object({
		policyId: z.string().min(1),
		assignmentType: z.enum(["organization", "team", "employee"]),
		teamId: z.string().optional(),
		employeeId: z.string().optional(),
		...assignmentDatesSchema,
	})
	.superRefine((input, context) => {
		const issue = (message: string, field: "teamId" | "employeeId") =>
			context.addIssue({ code: "custom", message, path: [field] });
		if (input.assignmentType === "organization") {
			if (input.teamId || input.employeeId) {
				issue(
					"Organization assignments cannot target teams or employees",
					input.teamId ? "teamId" : "employeeId",
				);
			}
		} else if (input.assignmentType === "team") {
			if (!input.teamId) issue("Team assignments require a teamId", "teamId");
			else if (input.employeeId) issue("Team assignments cannot target an employee", "employeeId");
		} else if (!input.employeeId) {
			issue("Employee assignments require an employeeId", "employeeId");
		} else if (input.teamId) {
			issue("Employee assignments cannot target a team", "teamId");
		}
	});

const setEmployeeAssignmentSchema = z.object({
	employeeId: z.string().min(1),
	/** Null clears the employee's own assignment. */
	policyId: z.string().min(1).nullable(),
	...assignmentDatesSchema,
});

export type CreateVacationPolicyAssignmentInput = z.input<typeof createAssignmentSchema>;
export type SetEmployeePolicyAssignmentInput = z.input<typeof setEmployeeAssignmentSchema>;

const RESOURCE = "vacation_policy_assignment";

// ============================================
// VACATION POLICY ASSIGNMENTS (Policies to org/team/employee)
// ============================================

/**
 * The active organization's vacation policies
 */
export const getVacationPolicies = organizationAction(
	{ name: "vacation.listPoliciesForAssignment", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("getVacationPolicies", () =>
					dbService.db
						.select()
						.from(vacationAllowance)
						.where(eq(vacationAllowance.organizationId, organizationId))
						.orderBy(vacationAllowance.startDate),
				)
				.pipe(
					Effect.mapError(
						(error) =>
							new DatabaseError({
								message: "Failed to fetch vacation policies",
								operation: "select",
								table: "vacation_allowance",
								cause: error,
							}),
					),
				);
		}),
);

/**
 * The active organization's vacation policy assignments; a scoped manager sees
 * the assignments of their reports.
 */
export const getVacationPolicyAssignments = organizationAction(
	{ name: "vacation.listPolicyAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			const dbService = yield* DatabaseService;
			const assignments = yield* dbService
				.query("getVacationPolicyAssignments", () =>
					dbService.db
						.select({
							id: vacationPolicyAssignment.id,
							policyId: vacationPolicyAssignment.policyId,
							organizationId: vacationPolicyAssignment.organizationId,
							assignmentType: vacationPolicyAssignment.assignmentType,
							teamId: vacationPolicyAssignment.teamId,
							employeeId: vacationPolicyAssignment.employeeId,
							priority: vacationPolicyAssignment.priority,
							effectiveFrom: vacationPolicyAssignment.effectiveFrom,
							effectiveUntil: vacationPolicyAssignment.effectiveUntil,
							effectiveStartDate: vacationPolicyAssignment.effectiveStartDate,
							effectiveEndDate: vacationPolicyAssignment.effectiveEndDate,
							isActive: vacationPolicyAssignment.isActive,
							createdAt: vacationPolicyAssignment.createdAt,
							policy: {
								id: vacationAllowance.id,
								name: vacationAllowance.name,
								startDate: vacationAllowance.startDate,
								validUntil: vacationAllowance.validUntil,
								isCompanyDefault: vacationAllowance.isCompanyDefault,
								defaultAnnualDays: vacationAllowance.defaultAnnualDays,
								accrualType: vacationAllowance.accrualType,
								allowCarryover: vacationAllowance.allowCarryover,
								maxCarryoverDays: vacationAllowance.maxCarryoverDays,
							},
							team: {
								id: team.id,
								name: team.name,
							},
							employee: {
								id: employee.id,
								firstName: user.firstName,
								lastName: user.lastName,
							},
						})
						.from(vacationPolicyAssignment)
						.innerJoin(
							vacationAllowance,
							and(
								eq(vacationPolicyAssignment.policyId, vacationAllowance.id),
								eq(vacationAllowance.organizationId, organizationId),
							),
						)
						.leftJoin(
							team,
							and(
								eq(vacationPolicyAssignment.teamId, team.id),
								eq(team.organizationId, organizationId),
							),
						)
						.leftJoin(
							employee,
							and(
								eq(vacationPolicyAssignment.employeeId, employee.id),
								eq(employee.organizationId, organizationId),
							),
						)
						.leftJoin(user, eq(employee.userId, user.id))
						.where(
							and(
								eq(vacationPolicyAssignment.organizationId, organizationId),
								eq(vacationPolicyAssignment.isActive, true),
							),
						)
						.orderBy(vacationAllowance.startDate),
				)
				.pipe(
					Effect.mapError(
						(error) =>
							new DatabaseError({
								message: "Failed to fetch vacation policy assignments",
								operation: "select",
								table: "vacation_policy_assignment",
								cause: error,
							}),
					),
				);
			const normalizedAssignments = assignments.map((assignment) => ({
				...assignment,
				employee: assignment.employee?.id
					? { ...assignment.employee, id: assignment.employee.id }
					: null,
			}));

			if (scope.organizationWide) {
				return normalizedAssignments;
			}

			return normalizedAssignments.filter(
				(assignment) =>
					assignment.assignmentType === "employee" &&
					assignment.employeeId !== null &&
					scope.employeeIds.has(assignment.employeeId),
			);
		}),
);

/**
 * Create a vacation policy assignment. A scoped manager may assign a policy to
 * their own reports; organization and team assignments and reviewed backdating
 * need an org admin.
 */
export const createVacationPolicyAssignment = organizationAction(
	{
		name: "vacation.createPolicyAssignment",
		requires: "scopedManager",
		schema: createAssignmentSchema,
		// A former employee gets no new policy assignment (#1438).
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			if (data.assignmentType !== "employee" || data.reviewedBackdate) {
				yield* actor.require("orgAdmin");
			}

			const dbService = yield* DatabaseService;
			const [policy] = yield* dbService.query("verifyPolicy", () =>
				dbService.db
					.select({ id: vacationAllowance.id })
					.from(vacationAllowance)
					.where(
						and(
							eq(vacationAllowance.id, data.policyId),
							eq(vacationAllowance.organizationId, organizationId),
						),
					)
					.limit(1),
			);
			if (!policy) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Vacation policy not found",
						entityType: "vacation_policy",
						entityId: data.policyId,
					}),
				);
			}

			if (data.employeeId) {
				yield* findManagedEmployee(actor, organizationId, data.employeeId, RESOURCE, "create");
			}

			const teamId = data.teamId;
			if (data.assignmentType === "team" && teamId) {
				const [assignedTeam] = yield* dbService.query("vacation.findTeam", () =>
					dbService.db
						.select({ id: team.id })
						.from(team)
						.where(and(eq(team.id, teamId), eq(team.organizationId, organizationId)))
						.limit(1),
				);
				if (!assignedTeam) {
					return yield* Effect.fail(
						new NotFoundError({ message: "Team not found", entityType: "team", entityId: teamId }),
					);
				}
			}

			return yield* dbService
				.query("createVacationPolicyAssignment", () =>
					writeVacationPolicyAssignment(dbService.db, {
						...data,
						organizationId,
						createdBy: actor.userId,
					}),
				)
				.pipe(Effect.mapError(vacationPolicyWriteFailure));
		}),
);

/**
 * An employee's direct policy assignment in effect today, if any
 */
export const getEmployeePolicyAssignment = organizationAction(
	{
		name: "vacation.employeePolicyAssignment",
		requires: "scopedManager",
		schema: z.string().min(1),
	},
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(actor, organizationId, employeeId, RESOURCE, "read");
			const dbService = yield* DatabaseService;

			const { today } = yield* dbService.query("vacation.date", () =>
				loadVacationPolicyHistoryContext(dbService.db, organizationId),
			);
			return yield* dbService.query("getEmployeePolicyAssignment", async () => {
				const [result] = await dbService.db
					.select({
						id: vacationPolicyAssignment.id,
						policyId: vacationPolicyAssignment.policyId,
						policy: {
							id: vacationAllowance.id,
							name: vacationAllowance.name,
							startDate: vacationAllowance.startDate,
							validUntil: vacationAllowance.validUntil,
							defaultAnnualDays: vacationAllowance.defaultAnnualDays,
						},
					})
					.from(vacationPolicyAssignment)
					.innerJoin(
						vacationAllowance,
						and(
							eq(vacationPolicyAssignment.policyId, vacationAllowance.id),
							eq(vacationAllowance.organizationId, organizationId),
						),
					)
					.where(
						and(
							eq(vacationPolicyAssignment.employeeId, employeeId),
							eq(vacationPolicyAssignment.organizationId, organizationId),
							lte(vacationPolicyAssignment.effectiveStartDate, today),
							or(
								isNull(vacationPolicyAssignment.effectiveEndDate),
								gt(vacationPolicyAssignment.effectiveEndDate, today),
							),
							eq(vacationPolicyAssignment.assignmentType, "employee"),
							eq(vacationPolicyAssignment.isActive, true),
						),
					)
					.limit(1);

				return result || null;
			});
		}),
);

/**
 * Set or clear an employee's direct policy assignment
 */
export const setEmployeePolicyAssignment = organizationAction(
	{
		name: "vacation.setEmployeePolicyAssignment",
		requires: "scopedManager",
		schema: setEmployeeAssignmentSchema,
		// Clearing stays possible; a new policy needs a current employee (#1438).
		addsEmployees: (input) => (input.policyId ? [input.employeeId] : []),
	},
	({ actor, organizationId, input: { employeeId, policyId, ...options } }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(actor, organizationId, employeeId, RESOURCE, "update");
			if (options.reviewedBackdate) {
				yield* actor.require("orgAdmin");
			}
			const dbService = yield* DatabaseService;
			yield* dbService
				.query("vacation.employeeAssignment", () =>
					writeVacationPolicyAssignment(dbService.db, {
						...options,
						organizationId,
						createdBy: actor.userId,
						policyId,
						employeeId,
						assignmentType: "employee",
					}),
				)
				.pipe(Effect.mapError(vacationPolicyWriteFailure));
		}),
);

/**
 * End a vacation policy assignment
 */
export const deleteVacationPolicyAssignment = organizationAction(
	{
		name: "vacation.deletePolicyAssignment",
		requires: "scopedManager",
		schema: z.object({ assignmentId: z.string().min(1), effectiveOn: z.string().optional() }),
	},
	({ actor, organizationId, input: { assignmentId, effectiveOn } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [existingAssignment] = yield* dbService.query("verifyAssignment", () =>
				dbService.db
					.select()
					.from(vacationPolicyAssignment)
					.where(
						and(
							eq(vacationPolicyAssignment.id, assignmentId),
							eq(vacationPolicyAssignment.organizationId, organizationId),
						),
					)
					.limit(1),
			);
			if (!existingAssignment) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Vacation policy assignment not found",
						entityType: "vacation_policy_assignment",
						entityId: assignmentId,
					}),
				);
			}

			if (existingAssignment.assignmentType !== "employee") {
				yield* actor.require("orgAdmin");
			}
			if (existingAssignment.employeeId) {
				yield* findManagedEmployee(
					actor,
					organizationId,
					existingAssignment.employeeId,
					RESOURCE,
					"delete",
				);
			}

			yield* dbService
				.query("deleteVacationPolicyAssignment", () =>
					endVacationPolicyAssignment(dbService.db, { organizationId, assignmentId, effectiveOn }),
				)
				.pipe(Effect.mapError(vacationPolicyWriteFailure));
		}),
);

/**
 * Company default policies (current and next scheduled): those marked
 * isCompanyDefault, grouped by current/next
 */
export const getCompanyDefaultPolicies = organizationAction(
	{ name: "vacation.companyDefaultPolicies", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const { today } = yield* dbService.query("vacation.date", () =>
				loadVacationPolicyHistoryContext(dbService.db, organizationId),
			);

			const policies = yield* dbService.query("getCompanyDefaultPolicies", () =>
				dbService.db
					.select({
						id: vacationAllowance.id,
						name: vacationAllowance.name,
						startDate: vacationAllowance.startDate,
						validUntil: vacationAllowance.validUntil,
						isCompanyDefault: vacationAllowance.isCompanyDefault,
						isActive: vacationAllowance.isActive,
						defaultAnnualDays: vacationAllowance.defaultAnnualDays,
						accrualType: vacationAllowance.accrualType,
						allowCarryover: vacationAllowance.allowCarryover,
						maxCarryoverDays: vacationAllowance.maxCarryoverDays,
					})
					.from(vacationAllowance)
					.where(
						and(
							eq(vacationAllowance.organizationId, organizationId),
							eq(vacationAllowance.isCompanyDefault, true),
							eq(vacationAllowance.isActive, true),
						),
					)
					.orderBy(vacationAllowance.startDate),
			);

			// Current: startDate <= today AND (validUntil IS NULL OR validUntil >= today)
			const currentPolicy = policies.find(
				(p) => p.startDate <= today && (!p.validUntil || p.validUntil >= today),
			);
			// Next scheduled: startDate > today AND validUntil IS NULL
			const nextPolicy = policies.find((p) => p.startDate > today && !p.validUntil);

			return {
				current: currentPolicy || null,
				next: nextPolicy || null,
			};
		}),
);

export const previewEmployeeVacationPolicy = organizationAction(
	{
		name: "vacation.previewEmployeePolicy",
		requires: "scopedManager",
		schema: z.object({ employeeId: z.string().min(1), date: z.string().min(1) }),
	},
	({ actor, organizationId, input: { employeeId, date } }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(actor, organizationId, employeeId, RESOURCE, "read");
			const service = yield* DatabaseService;
			return yield* service.query("vacation.preview", () =>
				loadEmployeeVacationPolicy(service.db, { organizationId, employeeId, date }),
			);
		}),
);

export const getVacationPolicyHistoryContext = organizationAction(
	{ name: "vacation.historyContext", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* service.query("vacation.historyContext", () =>
				loadVacationPolicyHistoryContext(service.db, organizationId),
			);
		}),
);
