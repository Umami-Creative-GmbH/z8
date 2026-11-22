import { and, eq } from "drizzle-orm";
import { workPolicyAssignment } from "@/db/schema";
import type { WorkPolicyAssignmentSourceKind } from "@/db/schema/contract-types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { utcMidnight } from "@/lib/employment-history/terms-in-force";
import type { ContractWriteTx } from "./contract-validation";

export type PolicyAssignmentScopeTarget =
	| { assignmentType: "organization"; teamId: null; employeeId: null; priority: 0 }
	| { assignmentType: "team"; teamId: string; employeeId: null; priority: 1 }
	| { assignmentType: "employee"; teamId: null; employeeId: string; priority: 2 };

function intervalsOverlap(
	aFrom: string,
	aUntil: string | null,
	bFrom: string,
	bUntil: string | null,
): boolean {
	const aEndsAfterBStarts = aUntil === null || aUntil > bFrom;
	const bEndsAfterAStarts = bUntil === null || bUntil > aFrom;
	return aEndsAfterBStarts && bEndsAfterAStarts;
}

function buildScopePredicate(organizationId: string, target: PolicyAssignmentScopeTarget) {
	const conditions = [
		eq(workPolicyAssignment.organizationId, organizationId),
		eq(workPolicyAssignment.assignmentType, target.assignmentType),
		eq(workPolicyAssignment.isActive, true),
	];
	if (target.assignmentType === "team") {
		conditions.push(eq(workPolicyAssignment.teamId, target.teamId));
	} else if (target.assignmentType === "employee") {
		conditions.push(eq(workPolicyAssignment.employeeId, target.employeeId));
	}
	return and(...conditions);
}

/**
 * Clears all overlap with `[effectiveFromDate, effectiveUntilDate)` across active
 * `work_policy_assignment` rows for the given scope so that post-`0322` `btree_gist`
 * non-overlap exclusion constraints and `effective_until_date > effective_from_date`
 * checks are strictly satisfied before inserting a new row (or leaving the window open).
 */
export async function clearPolicyAssignmentWindowInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		target: PolicyAssignmentScopeTarget;
		effectiveFromDate: string;
		effectiveUntilDate: string | null;
		now?: Date;
	},
): Promise<void> {
	const now = input.now ?? currentTimestamp();
	const activeRows = await tx
		.select()
		.from(workPolicyAssignment)
		.where(buildScopePredicate(input.organizationId, input.target));

	const newFrom = input.effectiveFromDate;
	const newUntil = input.effectiveUntilDate;

	for (const row of activeRows) {
		if (!intervalsOverlap(row.effectiveFromDate, row.effectiveUntilDate, newFrom, newUntil)) {
			continue;
		}

		const startsBefore = row.effectiveFromDate < newFrom;
		const endsAfter =
			newUntil !== null && (row.effectiveUntilDate === null || row.effectiveUntilDate > newUntil);

		if (startsBefore && endsAfter && newUntil !== null) {
			// Case B: existing row strictly straddles [newFrom, newUntil).
			// Trim existing row to [row.from, newFrom) and emit right remainder [newUntil, row.until).
			await tx
				.update(workPolicyAssignment)
				.set({
					effectiveUntilDate: newFrom,
					effectiveUntil: utcMidnight(parsePlainDate(newFrom)),
					updatedAt: now,
				})
				.where(
					and(
						eq(workPolicyAssignment.id, row.id),
						eq(workPolicyAssignment.organizationId, input.organizationId),
					),
				);

			await tx.insert(workPolicyAssignment).values({
				policyId: row.policyId,
				organizationId: row.organizationId,
				assignmentType: row.assignmentType,
				teamId: row.teamId,
				employeeId: row.employeeId,
				priority: row.priority,
				effectiveFromDate: newUntil,
				effectiveUntilDate: row.effectiveUntilDate,
				effectiveFrom: utcMidnight(parsePlainDate(newUntil)),
				effectiveUntil: row.effectiveUntilDate
					? utcMidnight(parsePlainDate(row.effectiveUntilDate))
					: null,
				sourceKind: row.sourceKind,
				sourceContractDefaultId: row.sourceContractDefaultId,
				sourceEmploymentHistoryId: row.sourceEmploymentHistoryId,
				sourceBatchItemId: null,
				isActive: true,
				createdBy: row.createdBy,
				updatedAt: now,
			});
		} else if (startsBefore) {
			// Case A: existing row starts before newFrom and ends inside [newFrom, newUntil].
			await tx
				.update(workPolicyAssignment)
				.set({
					effectiveUntilDate: newFrom,
					effectiveUntil: utcMidnight(parsePlainDate(newFrom)),
					updatedAt: now,
				})
				.where(
					and(
						eq(workPolicyAssignment.id, row.id),
						eq(workPolicyAssignment.organizationId, input.organizationId),
					),
				);
		} else if (endsAfter && newUntil !== null) {
			// Case D: existing row starts inside [newFrom, newUntil) and extends past newUntil.
			await tx
				.update(workPolicyAssignment)
				.set({
					effectiveFromDate: newUntil,
					effectiveFrom: utcMidnight(parsePlainDate(newUntil)),
					updatedAt: now,
				})
				.where(
					and(
						eq(workPolicyAssignment.id, row.id),
						eq(workPolicyAssignment.organizationId, input.organizationId),
					),
				);
		} else {
			// Case C: existing row is completely covered by [newFrom, newUntil).
			await tx
				.update(workPolicyAssignment)
				.set({
					isActive: false,
					updatedAt: now,
				})
				.where(
					and(
						eq(workPolicyAssignment.id, row.id),
						eq(workPolicyAssignment.organizationId, input.organizationId),
					),
				);
		}
	}
}

/**
 * Reconciles active `work_policy_assignment` rows around `[effectiveFromDate, effectiveUntilDate)`
 * and inserts a new active assignment row (if `policyId` is non-null).
 */
export async function replacePolicyAssignmentWindowInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		actorUserId: string;
		target: PolicyAssignmentScopeTarget;
		policyId: string | null;
		effectiveFromDate: string;
		effectiveUntilDate: string | null;
		sourceKind: WorkPolicyAssignmentSourceKind;
		sourceContractDefaultId?: string | null;
		sourceEmploymentHistoryId?: string | null;
		sourceBatchItemId?: string | null;
		now?: Date;
	},
): Promise<{ id: string } | null> {
	const now = input.now ?? currentTimestamp();
	await clearPolicyAssignmentWindowInTx(tx, {
		organizationId: input.organizationId,
		target: input.target,
		effectiveFromDate: input.effectiveFromDate,
		effectiveUntilDate: input.effectiveUntilDate,
		now,
	});

	if (!input.policyId) {
		return null;
	}

	const [inserted] = await tx
		.insert(workPolicyAssignment)
		.values({
			policyId: input.policyId,
			organizationId: input.organizationId,
			assignmentType: input.target.assignmentType,
			teamId: input.target.teamId,
			employeeId: input.target.employeeId,
			priority: input.target.priority,
			effectiveFromDate: input.effectiveFromDate,
			effectiveUntilDate: input.effectiveUntilDate,
			effectiveFrom: utcMidnight(parsePlainDate(input.effectiveFromDate)),
			effectiveUntil: input.effectiveUntilDate
				? utcMidnight(parsePlainDate(input.effectiveUntilDate))
				: null,
			sourceKind: input.sourceKind,
			sourceContractDefaultId: input.sourceContractDefaultId ?? null,
			sourceEmploymentHistoryId: input.sourceEmploymentHistoryId ?? null,
			sourceBatchItemId: input.sourceBatchItemId ?? null,
			isActive: true,
			createdBy: input.actorUserId,
			updatedAt: now,
		})
		.returning({ id: workPolicyAssignment.id });

	if (!inserted) {
		throw new Error("work_policy_assignment insert returned no row");
	}
	return inserted;
}
