import { and, eq, sql } from "drizzle-orm";
import { employeeEmploymentHistory, workPolicy, workPolicyAssignment } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { type ContractWriteTx, parseIsoCalendarDate } from "./contract-validation";
import {
	clearPolicyAssignmentWindowInTx,
	type PolicyAssignmentScopeTarget,
	replacePolicyAssignmentWindowInTx,
} from "./policy-assignment-intervals";

export interface AssignEmployeeWorkPolicyInput {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly policyId: string;
	readonly actorUserId: string;
	/** True for orgAdmin/owner; false for scoped managers (A1 guard). */
	readonly actorIsOrgAdmin: boolean;
	readonly effectiveFromDate?: string;
	readonly now?: Date;
}

export interface AssignEmployeeWorkPolicyResult {
	readonly assignmentId: string;
	readonly employeeId: string;
	readonly policyId: string;
	readonly effectiveFromDate: string;
	readonly sourceKind: "manager_assignment";
}

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

/**
 * Checks whether an active admin-pinned `contract_terms` work policy covers `effectiveFromDate`
 * (or any overlapping future range) and refuses scoped managers from overwriting or removing it.
 */
export async function refuseIfAdminPinnedContractTermsPolicyInTx(
	tx: Pick<ContractWriteTx, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		effectiveFromDate: string;
		actorIsOrgAdmin: boolean;
	},
): Promise<void> {
	if (input.actorIsOrgAdmin) return;

	const [activeEmpAssignments, confirmedPinnedTerms] = await Promise.all([
		tx
			.select({
				id: workPolicyAssignment.id,
				sourceKind: workPolicyAssignment.sourceKind,
				effectiveFromDate: workPolicyAssignment.effectiveFromDate,
				effectiveUntilDate: workPolicyAssignment.effectiveUntilDate,
			})
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, input.organizationId),
					eq(workPolicyAssignment.assignmentType, "employee"),
					eq(workPolicyAssignment.employeeId, input.employeeId),
					eq(workPolicyAssignment.isActive, true),
				),
			),
		tx
			.select({
				id: employeeEmploymentHistory.id,
				workPolicyId: employeeEmploymentHistory.workPolicyId,
				validFromDate: employeeEmploymentHistory.validFromDate,
				validUntilDate: employeeEmploymentHistory.validUntilDate,
			})
			.from(employeeEmploymentHistory)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					eq(employeeEmploymentHistory.employeeId, input.employeeId),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
				),
			),
	]);

	const pinnedAssignment = activeEmpAssignments.find(
		(row) =>
			row.sourceKind === "employment_terms" &&
			intervalsOverlap(
				row.effectiveFromDate,
				row.effectiveUntilDate,
				input.effectiveFromDate,
				null,
			),
	);

	const pinnedTerms = confirmedPinnedTerms.find(
		(row) =>
			row.workPolicyId !== null &&
			(row.validUntilDate === null || row.validUntilDate > row.validFromDate) &&
			intervalsOverlap(row.validFromDate, row.validUntilDate, input.effectiveFromDate, null),
	);

	if (pinnedAssignment || pinnedTerms) {
		throw new ValidationError({
			message:
				"This employee's work policy is pinned by administrator contract terms and cannot be overwritten by a scoped manager.",
			field: "policyId",
			refusal: "contract_terms_policy_pinned",
		});
	}
}

/**
 * Wage-free employee work policy assignment (A1).
 *
 * Preserves delegated scoped-manager policy assignment for managed employees without
 * reading or returning hourly wages, employment terms, org/team defaults, templates,
 * or leaving dates, while strictly refusing to overwrite an admin-pinned `contract_terms`
 * policy assignment.
 */
export async function assignEmployeeWorkPolicyInTx(
	tx: ContractWriteTx,
	input: AssignEmployeeWorkPolicyInput,
): Promise<AssignEmployeeWorkPolicyResult> {
	const now = input.now ?? currentTimestamp();

	const lockedEmployee = await tx.execute<{ id: string }>(sql`
		SELECT id
		FROM employee
		WHERE id = ${input.employeeId}::uuid
			AND organization_id = ${input.organizationId}
		FOR UPDATE
	`);
	if (lockedEmployee.rows.length === 0) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}

	const [policyRow] = await tx
		.select({ id: workPolicy.id, isActive: workPolicy.isActive })
		.from(workPolicy)
		.where(
			and(eq(workPolicy.id, input.policyId), eq(workPolicy.organizationId, input.organizationId)),
		)
		.limit(1);

	if (!policyRow) {
		throw new NotFoundError({
			message: "Work policy not found",
			entityType: "work_policy",
			entityId: input.policyId,
		});
	}
	if (!policyRow.isActive) {
		throw new ValidationError({
			message: "Inactive work policies cannot be assigned.",
			field: "policyId",
			refusal: "work_policy_inactive",
		});
	}

	const effectiveFromDate = input.effectiveFromDate
		? parseIsoCalendarDate(input.effectiveFromDate, "effectiveFromDate")
		: plainDateAt(
				systemClock.nowInstant(),
				await loadOrganizationTimezone(tx as unknown as DatabaseClient, input.organizationId),
			).toString();

	await refuseIfAdminPinnedContractTermsPolicyInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		effectiveFromDate,
		actorIsOrgAdmin: input.actorIsOrgAdmin,
	});

	const created = await replacePolicyAssignmentWindowInTx(tx, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		target: {
			assignmentType: "employee",
			teamId: null,
			employeeId: input.employeeId,
			priority: 2,
		},
		policyId: input.policyId,
		effectiveFromDate,
		effectiveUntilDate: null,
		sourceKind: "manager_assignment",
		sourceContractDefaultId: null,
		sourceEmploymentHistoryId: null,
		now,
	});

	if (!created) {
		throw new Error("work_policy_assignment insert returned no row");
	}

	return {
		assignmentId: created.id,
		employeeId: input.employeeId,
		policyId: input.policyId,
		effectiveFromDate,
		sourceKind: "manager_assignment",
	};
}

export async function assignEmployeeWorkPolicy(
	db: DatabaseClient,
	input: AssignEmployeeWorkPolicyInput,
): Promise<AssignEmployeeWorkPolicyResult> {
	return db.transaction((tx) => assignEmployeeWorkPolicyInTx(tx, input));
}

export interface CloseManualWorkPolicyAssignmentInput {
	readonly organizationId: string;
	readonly assignmentId: string;
	readonly actorIsOrgAdmin: boolean;
	readonly effectiveFromDate?: string;
	readonly now?: Date;
}

export interface CloseManualWorkPolicyAssignmentResult {
	readonly assignmentId: string;
	readonly closedFromDate: string;
	readonly assignmentType: "organization" | "team" | "employee";
}

/**
 * Closes a manual or legacy work policy assignment from `effectiveFromDate` (defaulting to
 * the organization's today) onward through `clearPolicyAssignmentWindowInTx`, preserving all
 * historical days before `effectiveFromDate`.
 *
 * Refuses to remove projection rows owned by `contract_default` or `employment_terms` (for
 * all actors) and enforces A1 scoped-manager pin protection atomically inside the transaction.
 */
export async function closeManualWorkPolicyAssignmentInTx(
	tx: ContractWriteTx,
	input: CloseManualWorkPolicyAssignmentInput,
): Promise<CloseManualWorkPolicyAssignmentResult> {
	const now = input.now ?? currentTimestamp();

	// Read target first to establish acyclic lock order (`employee` before `work_policy_assignment`).
	const [initialRow] = await tx
		.select({
			id: workPolicyAssignment.id,
			employeeId: workPolicyAssignment.employeeId,
		})
		.from(workPolicyAssignment)
		.where(
			and(
				eq(workPolicyAssignment.id, input.assignmentId),
				eq(workPolicyAssignment.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!initialRow) {
		throw new NotFoundError({
			message: "Work policy assignment not found",
			entityType: "work_policy_assignment",
			entityId: input.assignmentId,
		});
	}

	if (initialRow.employeeId) {
		await tx.execute(sql`
			SELECT id
			FROM employee
			WHERE id = ${initialRow.employeeId}::uuid
				AND organization_id = ${input.organizationId}
			FOR UPDATE
		`);
	}

	const [assignment] = await tx
		.select()
		.from(workPolicyAssignment)
		.where(
			and(
				eq(workPolicyAssignment.id, input.assignmentId),
				eq(workPolicyAssignment.organizationId, input.organizationId),
			),
		)
		.for("update");

	if (!assignment || !assignment.isActive) {
		throw new NotFoundError({
			message: "Work policy assignment not found",
			entityType: "work_policy_assignment",
			entityId: input.assignmentId,
		});
	}

	if (assignment.sourceKind === "contract_default") {
		throw new ValidationError({
			message:
				"Organization and primary-team default policy assignments are managed through Contract Defaults and cannot be deleted directly.",
			field: "assignmentId",
			refusal: "contract_default_assignment_protected",
		});
	}

	if (assignment.sourceKind === "employment_terms") {
		throw new ValidationError({
			message:
				"Work policy assignments pinned by employee contract terms must be changed through the employee's Contract tab and cannot be deleted directly.",
			field: "assignmentId",
			refusal: "contract_terms_policy_pinned",
		});
	}

	const effectiveFromDate = input.effectiveFromDate
		? parseIsoCalendarDate(input.effectiveFromDate, "effectiveFromDate")
		: plainDateAt(
				systemClock.nowInstant(),
				await loadOrganizationTimezone(tx as unknown as DatabaseClient, input.organizationId),
			).toString();

	if (assignment.assignmentType === "employee" && assignment.employeeId) {
		await refuseIfAdminPinnedContractTermsPolicyInTx(tx, {
			organizationId: input.organizationId,
			employeeId: assignment.employeeId,
			effectiveFromDate,
			actorIsOrgAdmin: input.actorIsOrgAdmin,
		});
	}

	let target: PolicyAssignmentScopeTarget;
	if (assignment.assignmentType === "employee" && assignment.employeeId) {
		target = {
			assignmentType: "employee",
			teamId: null,
			employeeId: assignment.employeeId,
			priority: 2,
		};
	} else if (assignment.assignmentType === "team" && assignment.teamId) {
		target = {
			assignmentType: "team",
			teamId: assignment.teamId,
			employeeId: null,
			priority: 1,
		};
	} else {
		target = {
			assignmentType: "organization",
			teamId: null,
			employeeId: null,
			priority: 0,
		};
	}

	await clearPolicyAssignmentWindowInTx(tx, {
		organizationId: input.organizationId,
		target,
		effectiveFromDate,
		effectiveUntilDate: null,
		now,
	});

	return {
		assignmentId: assignment.id,
		closedFromDate: effectiveFromDate,
		assignmentType: assignment.assignmentType,
	};
}

export async function closeManualWorkPolicyAssignment(
	db: DatabaseClient,
	input: CloseManualWorkPolicyAssignmentInput,
): Promise<CloseManualWorkPolicyAssignmentResult> {
	return db.transaction((tx) => closeManualWorkPolicyAssignmentInTx(tx, input));
}
