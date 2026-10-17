import { and, eq, gt, gte, isNull, lt, or } from "drizzle-orm";
import { type EmployeeEmploymentHistory, workPolicy, workPolicyAssignment } from "@/db/schema";
import { compareInstants, instantFromDate } from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import type { TermsWriteClient, TermsWriteScope } from "./write-terms";

/** Called under the terms command's employee lock, in the same transaction. */
export async function syncTermsPolicy(
	tx: TermsWriteClient,
	scope: TermsWriteScope & { now: Date },
	terms: EmployeeEmploymentHistory,
) {
	if (terms.reviewState !== "confirmed" || !terms.workPolicyId) return;
	const [policy] = await tx
		.select({ id: workPolicy.id })
		.from(workPolicy)
		.where(
			and(
				eq(workPolicy.id, terms.workPolicyId),
				eq(workPolicy.organizationId, scope.organizationId),
			),
		);
	if (!policy)
		throw new NotFoundError({
			message: "Work policy not found",
			entityType: "work_policy",
			entityId: terms.workPolicyId,
		});
	const employeeScope = and(
		eq(workPolicyAssignment.organizationId, scope.organizationId),
		eq(workPolicyAssignment.employeeId, scope.employeeId),
		eq(workPolicyAssignment.assignmentType, "employee"),
	);
	// Existing projections (and legacy assignments with the same natural key)
	// keep their identity when a neighbouring terms window is shortened/restored.
	const matchingScope = and(
		employeeScope,
		eq(workPolicyAssignment.policyId, terms.workPolicyId),
		eq(workPolicyAssignment.effectiveFrom, terms.validFrom),
	);
	const [existing] = await tx
		.select({ id: workPolicyAssignment.id })
		.from(workPolicyAssignment)
		.where(matchingScope);
	if (
		terms.validUntil &&
		compareInstants(instantFromDate(terms.validUntil), instantFromDate(terms.validFrom)) <= 0
	) {
		await tx
			.update(workPolicyAssignment)
			.set({
				isActive: false,
				effectiveUntil: terms.validUntil,
				updatedAt: scope.now,
			})
			.where(matchingScope);
		return;
	}
	const overlaps = and(
		employeeScope,
		eq(workPolicyAssignment.isActive, true),
		or(
			isNull(workPolicyAssignment.effectiveUntil),
			gt(workPolicyAssignment.effectiveUntil, terms.validFrom),
		),
		terms.validUntil
			? or(
					isNull(workPolicyAssignment.effectiveFrom),
					lt(workPolicyAssignment.effectiveFrom, terms.validUntil),
				)
			: undefined,
	);
	// Preserve history before the new terms, including legacy/manual overrides.
	await tx
		.update(workPolicyAssignment)
		.set({ effectiveUntil: terms.validFrom, updatedAt: scope.now })
		.where(
			and(
				overlaps,
				or(
					isNull(workPolicyAssignment.effectiveFrom),
					lt(workPolicyAssignment.effectiveFrom, terms.validFrom),
				),
			),
		);
	await tx
		.update(workPolicyAssignment)
		.set({ isActive: false, updatedAt: scope.now })
		.where(and(overlaps, gte(workPolicyAssignment.effectiveFrom, terms.validFrom)));
	const values = {
		organizationId: scope.organizationId,
		employeeId: scope.employeeId,
		policyId: terms.workPolicyId,
		assignmentType: "employee" as const,
		teamId: null,
		priority: 2,
		effectiveFrom: terms.validFrom,
		effectiveUntil: terms.validUntil,
		isActive: true,
		updatedAt: scope.now,
	};
	if (existing) {
		await tx
			.update(workPolicyAssignment)
			.set(values)
			.where(and(employeeScope, eq(workPolicyAssignment.id, existing.id)));
	} else {
		await tx.insert(workPolicyAssignment).values({ ...values, createdBy: scope.actorUserId });
	}
}
/** Cancelling terms removes only the employee projection with their natural key. */
export async function removeTermsPolicy(
	tx: TermsWriteClient,
	scope: TermsWriteScope & { now: Date },
	terms: EmployeeEmploymentHistory,
) {
	if (!terms.workPolicyId) return;
	await tx
		.update(workPolicyAssignment)
		.set({ isActive: false, updatedAt: scope.now })
		.where(
			and(
				eq(workPolicyAssignment.organizationId, scope.organizationId),
				eq(workPolicyAssignment.employeeId, scope.employeeId),
				eq(workPolicyAssignment.assignmentType, "employee"),
				eq(workPolicyAssignment.policyId, terms.workPolicyId),
				eq(workPolicyAssignment.effectiveFrom, terms.validFrom),
			),
		);
}
