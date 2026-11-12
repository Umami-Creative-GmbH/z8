"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	absenceCategory,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	employeeGroup,
	employeeGroupMember,
	location,
	team,
} from "@/db/schema";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	normalizeApprovalPolicyInputForTest,
	type PolicyInput,
	uniqueValues,
	upsertPolicyInputSchema,
} from "./action-helpers";

const employeeGroupInputSchema = z.object({
	id: z.string().optional(),
	name: z.string().trim().min(1, "Employee group name is required."),
	description: z.string().trim().optional(),
	isActive: z.boolean(),
	employeeIds: z.array(z.string().trim().min(1)),
});

type DatabaseApproverType = Exclude<PolicyInput["stages"][number]["approverType"], "team_lead">;
type OvertimeRiskValue = "none" | "warning" | "violation";

function isOvertimeRiskValue(value: string): value is OvertimeRiskValue {
	return value === "none" || value === "warning" || value === "violation";
}

function valuesForReferenceCondition(condition: PolicyInput["conditions"][number]) {
	if (condition.operator === "equals") {
		return condition.value ? [condition.value] : [];
	}

	if (condition.operator === "in") {
		return uniqueValues(condition.values ?? []);
	}

	return [];
}

/** The approvers a policy names; each must be on the current roster. */
function specificApproverIds(input: Pick<PolicyInput, "stages">) {
	return input.stages.flatMap((stage) =>
		stage.approverType === "specific_employee" && stage.approverEmployeeId
			? [stage.approverEmployeeId]
			: [],
	);
}

async function findMissingOrganizationReferences(
	db: DatabaseClient,
	organizationId: string,
	ids: string[],
	table: typeof team | typeof location | typeof absenceCategory,
) {
	const uniqueIds = uniqueValues(ids);
	if (uniqueIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({ id: table.id })
		.from(table)
		.where(and(eq(table.organizationId, organizationId), inArray(table.id, uniqueIds)));
	const foundIds = new Set(rows.map((row) => row.id));

	return uniqueIds.filter((id) => !foundIds.has(id));
}

async function findMissingActiveEmployeeGroups(
	db: DatabaseClient,
	organizationId: string,
	ids: string[],
) {
	const uniqueIds = uniqueValues(ids);
	if (uniqueIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({ id: employeeGroup.id })
		.from(employeeGroup)
		.where(
			and(
				eq(employeeGroup.organizationId, organizationId),
				eq(employeeGroup.isActive, true),
				inArray(employeeGroup.id, uniqueIds),
			),
		);
	const foundIds = new Set(rows.map((row) => row.id));

	return uniqueIds.filter((id) => !foundIds.has(id));
}

/**
 * The teams, locations, absence categories and employee groups a policy names
 * must belong to the organization. Its specific approvers are checked by the
 * action's current-roster check.
 */
async function hasInvalidPolicyReferences(
	db: DatabaseClient,
	organizationId: string,
	input: PolicyInput,
) {
	const teamIds: string[] = [];
	const locationIds: string[] = [];
	const absenceCategoryIds: string[] = [];
	const employeeGroupIds: string[] = [];

	for (const condition of input.conditions) {
		const ids = valuesForReferenceCondition(condition);
		if (condition.conditionType === "team") {
			teamIds.push(...ids);
		} else if (condition.conditionType === "location") {
			locationIds.push(...ids);
		} else if (condition.conditionType === "absence_category") {
			absenceCategoryIds.push(...ids);
		} else if (condition.conditionType === "employee_group") {
			employeeGroupIds.push(...ids);
		}
	}

	const missing = await Promise.all([
		findMissingOrganizationReferences(db, organizationId, teamIds, team),
		findMissingOrganizationReferences(db, organizationId, locationIds, location),
		findMissingOrganizationReferences(db, organizationId, absenceCategoryIds, absenceCategory),
		findMissingActiveEmployeeGroups(db, organizationId, employeeGroupIds),
	]);

	return missing.some((ids) => ids.length > 0);
}

function conditionInsertValue(
	organizationId: string,
	policyId: string,
	condition: PolicyInput["conditions"][number],
) {
	const valueJson = { value: condition.value, values: condition.values };
	const equalValue = condition.operator === "equals" ? condition.value : undefined;
	const overtimeRisk = isOvertimeRiskValue(equalValue ?? "")
		? (equalValue as OvertimeRiskValue)
		: undefined;

	return {
		organizationId,
		policyId,
		conditionType: condition.conditionType,
		operator: condition.operator,
		valueJson,
		amountMin: condition.amountMin?.toString(),
		amountMax: condition.amountMax?.toString(),
		overtimeRisk: condition.conditionType === "overtime_risk" ? overtimeRisk : undefined,
		teamId: condition.conditionType === "team" ? equalValue : undefined,
		locationId: condition.conditionType === "location" ? equalValue : undefined,
		absenceCategoryId: condition.conditionType === "absence_category" ? equalValue : undefined,
		employeeGroupId: condition.conditionType === "employee_group" ? equalValue : undefined,
	};
}

function databaseApproverType(
	approverType: PolicyInput["stages"][number]["approverType"],
): DatabaseApproverType {
	if (approverType === "team_lead") {
		throw new Error("Unsupported approver type.");
	}

	return approverType;
}

/** A failed save, with a message safe to show users. */
function saveFailed(message: string) {
	return (error: DatabaseError) => new DatabaseError({ ...error, message });
}

export const getApprovalPolicies = organizationAction(
	{ name: "approvalPolicies.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("approvalPolicies.list", () =>
				dbService.db.query.approvalPolicy.findMany({
					where: (table, { eq: equals }) => equals(table.organizationId, organizationId),
					with: { conditions: true, stages: true },
					orderBy: (table, { asc }) => [asc(table.priority)],
				}),
			);
		}),
);

export const upsertApprovalPolicy = organizationAction(
	{
		name: "approvalPolicies.upsert",
		requires: "orgAdmin",
		schema: upsertPolicyInputSchema,
		addsEmployees: specificApproverIds,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const normalized = normalizeApprovalPolicyInputForTest(input);
			if (!normalized.success) {
				return yield* Effect.fail(new ValidationError({ message: normalized.error }));
			}
			const policy = normalized.data;
			const dbService = yield* DatabaseService;
			const db = dbService.db;

			if (input.id) {
				const policyId = input.id;
				const existingPolicy = yield* dbService.query("approvalPolicies.findExisting", () =>
					db.query.approvalPolicy.findFirst({
						where: and(
							eq(approvalPolicy.id, policyId),
							eq(approvalPolicy.organizationId, organizationId),
						),
						columns: { id: true },
					}),
				);
				if (!existingPolicy) {
					return yield* Effect.fail(
						new ValidationError({ message: "Approval policy could not be saved." }),
					);
				}
			}

			const invalidReferences = yield* dbService.query("approvalPolicies.checkReferences", () =>
				hasInvalidPolicyReferences(db, organizationId, policy),
			);
			if (invalidReferences) {
				return yield* Effect.fail(
					new ValidationError({ message: "One or more policy references are invalid." }),
				);
			}

			yield* dbService
				.query("approvalPolicies.save", () =>
					db.transaction(async (tx) => {
						const [savedPolicy] = await tx
							.insert(approvalPolicy)
							.values({
								id: input.id,
								organizationId,
								name: policy.name,
								description: policy.description || null,
								isActive: policy.isActive,
								priority: policy.priority,
								createdBy: actor.userId,
								updatedBy: actor.userId,
							})
							.onConflictDoUpdate({
								target: approvalPolicy.id,
								set: {
									name: policy.name,
									description: policy.description || null,
									isActive: policy.isActive,
									priority: policy.priority,
									updatedBy: actor.userId,
								},
								where: eq(approvalPolicy.organizationId, organizationId),
							})
							.returning();

						await Promise.all([
							(async () => {
								await tx
									.delete(approvalPolicyCondition)
									.where(
										and(
											eq(approvalPolicyCondition.policyId, savedPolicy.id),
											eq(approvalPolicyCondition.organizationId, organizationId),
										),
									);

								if (policy.conditions.length > 0) {
									await tx
										.insert(approvalPolicyCondition)
										.values(
											policy.conditions.map((condition) =>
												conditionInsertValue(organizationId, savedPolicy.id, condition),
											),
										);
								}
							})(),
							(async () => {
								await tx
									.delete(approvalPolicyStage)
									.where(
										and(
											eq(approvalPolicyStage.policyId, savedPolicy.id),
											eq(approvalPolicyStage.organizationId, organizationId),
										),
									);

								if (policy.stages.length > 0) {
									await tx.insert(approvalPolicyStage).values(
										policy.stages.map((stage) => ({
											organizationId,
											policyId: savedPolicy.id,
											stepOrder: stage.stepOrder,
											label: stage.label,
											approverType: databaseApproverType(stage.approverType),
											approverEmployeeId: stage.approverEmployeeId,
											fallbackBehavior: stage.fallbackBehavior,
										})),
									);
								}
							})(),
						]);
					}),
				)
				.pipe(Effect.mapError(saveFailed("Approval policy could not be saved.")));

			revalidatePath("/settings/approval-policies");
		}),
);

export const getEmployeeGroups = organizationAction(
	{ name: "approvalPolicies.listEmployeeGroups", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("approvalPolicies.listEmployeeGroups", () =>
				dbService.db.query.employeeGroup.findMany({
					where: (table, { eq: equals }) => equals(table.organizationId, organizationId),
					with: { members: true },
				}),
			);
		}),
);

export const upsertEmployeeGroup = organizationAction(
	{
		name: "approvalPolicies.upsertEmployeeGroup",
		requires: "orgAdmin",
		schema: employeeGroupInputSchema,
		// The save replaces the members, so every member must be on the current roster.
		addsEmployees: (input) => input.employeeIds,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const employeeIds = uniqueValues(input.employeeIds);
			if (employeeIds.length !== input.employeeIds.length) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Employee group members must be unique.",
						field: "employeeIds",
					}),
				);
			}

			const dbService = yield* DatabaseService;
			const db = dbService.db;
			if (input.id) {
				const groupId = input.id;
				const existingGroup = yield* dbService.query(
					"approvalPolicies.findExistingEmployeeGroup",
					() =>
						db.query.employeeGroup.findFirst({
							where: and(
								eq(employeeGroup.id, groupId),
								eq(employeeGroup.organizationId, organizationId),
							),
							columns: { id: true },
						}),
				);
				if (!existingGroup) {
					return yield* Effect.fail(
						new ValidationError({ message: "Employee group could not be saved." }),
					);
				}
			}

			yield* dbService
				.query("approvalPolicies.saveEmployeeGroup", () =>
					db.transaction(async (tx) => {
						const [group] = await tx
							.insert(employeeGroup)
							.values({
								id: input.id,
								organizationId,
								name: input.name,
								description: input.description || null,
								isActive: input.isActive,
							})
							.onConflictDoUpdate({
								target: employeeGroup.id,
								set: {
									name: input.name,
									description: input.description || null,
									isActive: input.isActive,
								},
								where: eq(employeeGroup.organizationId, organizationId),
							})
							.returning();

						await tx
							.delete(employeeGroupMember)
							.where(
								and(
									eq(employeeGroupMember.groupId, group.id),
									eq(employeeGroupMember.organizationId, organizationId),
								),
							);

						if (employeeIds.length > 0) {
							await tx.insert(employeeGroupMember).values(
								employeeIds.map((employeeId) => ({
									organizationId,
									groupId: group.id,
									employeeId,
									createdBy: actor.userId,
								})),
							);
						}
					}),
				)
				.pipe(Effect.mapError(saveFailed("Employee group could not be saved.")));

			revalidatePath("/settings/approval-policies");
		}),
);
