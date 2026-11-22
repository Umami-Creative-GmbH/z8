import { and, eq, sql } from "drizzle-orm";
import { workPolicyAssignment } from "@/db/schema";
import type { WorkPolicyAssignmentSourceKind } from "@/db/schema/contract-types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { dateFromInstant, parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
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

export interface CappedPolicyAssignmentRecord {
	readonly id: string;
	readonly previousEffectiveUntilDate: string | null;
	readonly previousEffectiveUntil: string | null;
}

/**
 * Caps active employee `work_policy_assignment` rows spanning `cutoffLocalDate` and
 * deactivates future ones when an employee departs, returning the exact capped rows and
 * their pre-departure end dates so a later forward departure correction only restores rows
 * that departure shortened and never extends past their original end date (A3-20).
 */
export async function capAndDeactivateEmployeePolicyAssignmentsOnDepartureInTx(
	tx: Pick<ContractWriteTx, "execute">,
	input: {
		organizationId: string;
		employeeId: string;
		cutoff: Date;
		cutoffLocalDate: string;
		now: Date;
	},
): Promise<{
	cappedAssignments: CappedPolicyAssignmentRecord[];
	deactivatedAssignmentIds: string[];
}> {
	const toCap = await tx.execute<{
		id: string;
		prev_until_date: string | null;
		prev_until: Date | string | null;
	}>(sql`
		SELECT
			id,
			to_char(effective_until_date, 'YYYY-MM-DD') AS prev_until_date,
			effective_until AS prev_until
		FROM work_policy_assignment
		WHERE organization_id = ${input.organizationId}
			AND assignment_type = 'employee'
			AND employee_id = ${input.employeeId}::uuid
			AND is_active = true
			AND effective_from_date < ${input.cutoffLocalDate}::date
			AND (effective_until_date IS NULL OR effective_until_date > ${input.cutoffLocalDate}::date)
	`);

	const cappedAssignments: CappedPolicyAssignmentRecord[] = toCap.rows.map((row) => ({
		id: row.id,
		previousEffectiveUntilDate: row.prev_until_date ?? null,
		previousEffectiveUntil:
			row.prev_until instanceof Date
				? row.prev_until.toISOString()
				: typeof row.prev_until === "string"
					? row.prev_until
					: null,
	}));

	if (cappedAssignments.length > 0) {
		await tx.execute(sql`
			UPDATE work_policy_assignment
			SET effective_until = ${input.cutoff},
				effective_until_date = ${input.cutoffLocalDate}::date,
				updated_at = ${input.now}
			WHERE organization_id = ${input.organizationId}
				AND assignment_type = 'employee'
				AND employee_id = ${input.employeeId}::uuid
				AND is_active = true
				AND effective_from_date < ${input.cutoffLocalDate}::date
				AND (effective_until_date IS NULL OR effective_until_date > ${input.cutoffLocalDate}::date)
		`);
	}

	const deactivated = await tx.execute<{ id: string }>(sql`
		UPDATE work_policy_assignment
		SET is_active = false, updated_at = ${input.now}
		WHERE organization_id = ${input.organizationId}
			AND assignment_type = 'employee'
			AND employee_id = ${input.employeeId}::uuid
			AND is_active = true
			AND effective_from_date >= ${input.cutoffLocalDate}::date
		RETURNING id
	`);

	return {
		cappedAssignments,
		deactivatedAssignmentIds: deactivated.rows.map((row) => row.id),
	};
}

/**
 * Keeps stint-scoped employee `work_policy_assignment` rows aligned when an effective past
 * departure date is corrected earlier or later (A1-3, A2-16, A3-20), without touching
 * assignments belonging to any subsequent rehire stint or extending deliberately ended rows.
 */
export async function reconcileStintEmployeePolicyAssignmentsOnCutoffCorrectionInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		previousCutoffLocalDate: string;
		nextCutoffLocalDate: string;
		newCutoffDate: Date;
		nextPeriodStartLocalDate: string | null;
		nextPeriodStart: Date | null;
		cappedPolicyAssignments: readonly CappedPolicyAssignmentRecord[];
		now: Date;
	},
): Promise<{ newlyCappedAssignments: CappedPolicyAssignmentRecord[] }> {
	const stintProvenanceGuard = sql`AND (
		source_employment_history_id IS NULL
		OR source_employment_history_id IN (
			SELECT id
			FROM employee_employment_history
			WHERE organization_id = ${input.organizationId}
				AND employee_id = ${input.employeeId}::uuid
				AND employment_period_id = ${input.employmentPeriodId}::uuid
		)
	)`;
	const nextPeriodUpperBoundGuard = input.nextPeriodStartLocalDate
		? sql`AND effective_from_date < ${input.nextPeriodStartLocalDate}::date`
		: sql``;

	if (input.nextCutoffLocalDate > input.previousCutoffLocalDate) {
		const effectiveExtendedUntilDate =
			input.nextPeriodStartLocalDate && input.nextCutoffLocalDate > input.nextPeriodStartLocalDate
				? input.nextPeriodStartLocalDate
				: input.nextCutoffLocalDate;
		const effectiveExtendedUntilTs =
			input.nextPeriodStart && input.newCutoffDate.getTime() > input.nextPeriodStart.getTime()
				? input.nextPeriodStart
				: input.newCutoffDate;

		// A3-20: Extend ONLY assignments recorded as departure-shortened, and never past each
		// assignment's original pre-departure end date!
		for (const capped of input.cappedPolicyAssignments) {
			const originalUntilDate = capped.previousEffectiveUntilDate;
			if (originalUntilDate !== null && originalUntilDate <= input.previousCutoffLocalDate) {
				continue;
			}
			const clampedUntilDate =
				originalUntilDate !== null && originalUntilDate < effectiveExtendedUntilDate
					? originalUntilDate
					: effectiveExtendedUntilDate;
			const clampedUntilTs =
				originalUntilDate !== null && originalUntilDate < effectiveExtendedUntilDate
					? capped.previousEffectiveUntil
						? dateFromInstant(
								parseInstant(
									capped.previousEffectiveUntil.includes("T")
										? capped.previousEffectiveUntil
										: `${capped.previousEffectiveUntil.replace(" ", "T")}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(capped.previousEffectiveUntil) ? "" : "Z"}`,
								),
							)
						: utcMidnight(parsePlainDate(originalUntilDate))
					: effectiveExtendedUntilTs;
			await tx.execute(sql`
				UPDATE work_policy_assignment a
				SET effective_until = ${clampedUntilTs},
					effective_until_date = ${clampedUntilDate}::date,
					updated_at = ${input.now}
				WHERE a.organization_id = ${input.organizationId}
					AND a.id = ${capped.id}::uuid
					AND a.assignment_type = 'employee'
					AND a.employee_id = ${input.employeeId}::uuid
					AND a.is_active = true
					AND a.effective_until_date = ${input.previousCutoffLocalDate}::date
					AND (
						a.source_employment_history_id IS NULL
						OR a.source_employment_history_id IN (
							SELECT id
							FROM employee_employment_history
							WHERE organization_id = ${input.organizationId}
								AND employee_id = ${input.employeeId}::uuid
								AND employment_period_id = ${input.employmentPeriodId}::uuid
						)
					)
					AND NOT EXISTS (
						SELECT 1
						FROM work_policy_assignment later
						WHERE later.organization_id = a.organization_id
							AND later.assignment_type = 'employee'
							AND later.employee_id = a.employee_id
							AND later.is_active = true
							AND later.id <> a.id
							AND later.effective_from_date >= ${input.previousCutoffLocalDate}::date
							AND later.effective_from_date < ${clampedUntilDate}::date
					)
			`);
		}
	}

	const toCapNow = await tx.execute<{
		id: string;
		prev_until_date: string | null;
		prev_until: Date | string | null;
	}>(sql`
		SELECT
			id,
			to_char(effective_until_date, 'YYYY-MM-DD') AS prev_until_date,
			effective_until AS prev_until
		FROM work_policy_assignment
		WHERE organization_id = ${input.organizationId}
			AND assignment_type = 'employee'
			AND employee_id = ${input.employeeId}::uuid
			AND is_active = true
			AND effective_from_date < ${input.nextCutoffLocalDate}::date
			AND (effective_until_date IS NULL OR effective_until_date > ${input.nextCutoffLocalDate}::date)
			${stintProvenanceGuard}
	`);
	const newlyCappedAssignments: CappedPolicyAssignmentRecord[] = toCapNow.rows.map((row) => ({
		id: row.id,
		previousEffectiveUntilDate: row.prev_until_date ?? null,
		previousEffectiveUntil:
			row.prev_until instanceof Date
				? row.prev_until.toISOString()
				: typeof row.prev_until === "string"
					? row.prev_until
					: null,
	}));

	if (newlyCappedAssignments.length > 0) {
		await tx.execute(sql`
			UPDATE work_policy_assignment
			SET effective_until = ${input.newCutoffDate},
				effective_until_date = ${input.nextCutoffLocalDate}::date,
				updated_at = ${input.now}
			WHERE organization_id = ${input.organizationId}
				AND assignment_type = 'employee'
				AND employee_id = ${input.employeeId}::uuid
				AND is_active = true
				AND effective_from_date < ${input.nextCutoffLocalDate}::date
				AND (effective_until_date IS NULL OR effective_until_date > ${input.nextCutoffLocalDate}::date)
				${stintProvenanceGuard}
		`);
	}
	await tx.execute(sql`
		UPDATE work_policy_assignment
		SET is_active = false, updated_at = ${input.now}
		WHERE organization_id = ${input.organizationId}
			AND assignment_type = 'employee'
			AND employee_id = ${input.employeeId}::uuid
			AND is_active = true
			AND effective_from_date >= ${input.nextCutoffLocalDate}::date
			${nextPeriodUpperBoundGuard}
			${stintProvenanceGuard}
	`);

	return { newlyCappedAssignments };
}
