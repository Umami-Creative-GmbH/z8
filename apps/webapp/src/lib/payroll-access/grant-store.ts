import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import {
	auditLog,
	employee,
	payrollAccessEmployee,
	payrollAccessGrant,
	payrollAccessTeam,
	team,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import {
	buildValidatedPayrollAccessInput,
	diffPayrollAccessScope,
	type PayrollAccessScope,
	payrollAccessGrantAuditChanges,
	type SavePayrollAccessInput,
	validateId,
	validateIdList,
} from "./grant-scope";

/**
 * Writes to payroll access grants (#749). Each write runs inside the caller's
 * transaction, locks the officer's active grant, and records an audit entry with the
 * old and new scope in the same transaction.
 *
 * A revoked grant stays inactive with the scope it had; a later grant for the same
 * officer is a new row.
 */

type PayrollAccessTransaction = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"select" | "insert" | "update" | "delete"
>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function savePayrollAccessGrant(
	tx: PayrollAccessTransaction,
	input: { organizationId: string; actorUserId: string; grant: SavePayrollAccessInput },
): Promise<{ grantId: string; outcome: "created" | "changed" | "unchanged" }> {
	const { organizationId, actorUserId } = input;
	if (!input.grant || typeof input.grant !== "object") {
		throw new ValidationError({ message: "Payroll access input is required" });
	}
	const payrollEmployeeId = validateId(input.grant.payrollEmployeeId, "payrollEmployeeId");
	const requestedTeamIds = validateIdList(input.grant.teamIds, "teamIds");
	const requestedEmployeeIds = validateIdList(input.grant.employeeIds, "employeeIds");
	if (![payrollEmployeeId, ...requestedTeamIds, ...requestedEmployeeIds].every(isUuid)) {
		throw new ValidationError({ message: "Payroll access IDs must be valid" });
	}

	const [current] = await tx
		.select({ id: payrollAccessGrant.id, scope: payrollAccessGrant.scope })
		.from(payrollAccessGrant)
		.where(
			and(
				eq(payrollAccessGrant.organizationId, organizationId),
				eq(payrollAccessGrant.payrollEmployeeId, payrollEmployeeId),
				eq(payrollAccessGrant.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	const currentScope = current ? await readGrantScope(tx, organizationId, current) : null;

	const [activeEmployeeRows, teamRows] = await Promise.all([
		tx
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
					inArray(employee.id, [payrollEmployeeId, ...requestedEmployeeIds]),
				),
			),
		requestedTeamIds.length > 0
			? tx
					.select({ id: team.id })
					.from(team)
					.where(and(eq(team.organizationId, organizationId), inArray(team.id, requestedTeamIds)))
			: Promise.resolve([]),
	]);

	const validated = buildValidatedPayrollAccessInput(input.grant, {
		activeEmployeeIds: activeEmployeeRows.map((row) => row.id),
		organizationTeamIds: teamRows.map((row) => row.id),
		retainedEmployeeIds: currentScope?.employeeIds ?? [],
	});
	const nextScope: PayrollAccessScope = {
		scope: validated.scope,
		teamIds: validated.teamIds,
		employeeIds: validated.employeeIds,
	};

	if (!current || !currentScope) {
		const [inserted] = await tx
			.insert(payrollAccessGrant)
			.values({
				organizationId,
				payrollEmployeeId,
				scope: nextScope.scope,
				createdBy: actorUserId,
				updatedBy: actorUserId,
			})
			.returning({ id: payrollAccessGrant.id });
		if (!inserted) {
			throw new DatabaseError({
				message: "Failed to create payroll access grant",
				operation: "insert",
				table: "payroll_access_grant",
			});
		}
		await insertScopeRows(tx, {
			organizationId,
			actorUserId,
			grantId: inserted.id,
			teamIds: nextScope.teamIds,
			employeeIds: nextScope.employeeIds,
		});
		await writeGrantAudit(tx, {
			organizationId,
			actorUserId,
			grantId: inserted.id,
			payrollEmployeeId,
			action: AuditAction.PAYROLL_ACCESS_GRANT_CREATED,
			from: null,
			to: nextScope,
		});
		return { grantId: inserted.id, outcome: "created" };
	}

	const diff = diffPayrollAccessScope(currentScope, nextScope);
	if (!diff.changed) {
		return { grantId: current.id, outcome: "unchanged" };
	}

	await tx
		.update(payrollAccessGrant)
		.set({ scope: nextScope.scope, updatedBy: actorUserId })
		.where(
			and(
				eq(payrollAccessGrant.id, current.id),
				eq(payrollAccessGrant.organizationId, organizationId),
			),
		);
	if (diff.removedTeamIds.length > 0) {
		await tx
			.delete(payrollAccessTeam)
			.where(
				and(
					eq(payrollAccessTeam.organizationId, organizationId),
					eq(payrollAccessTeam.grantId, current.id),
					inArray(payrollAccessTeam.teamId, diff.removedTeamIds),
				),
			);
	}
	if (diff.removedEmployeeIds.length > 0) {
		await tx
			.delete(payrollAccessEmployee)
			.where(
				and(
					eq(payrollAccessEmployee.organizationId, organizationId),
					eq(payrollAccessEmployee.grantId, current.id),
					inArray(payrollAccessEmployee.employeeId, diff.removedEmployeeIds),
				),
			);
	}
	await insertScopeRows(tx, {
		organizationId,
		actorUserId,
		grantId: current.id,
		teamIds: diff.addedTeamIds,
		employeeIds: diff.addedEmployeeIds,
	});
	await writeGrantAudit(tx, {
		organizationId,
		actorUserId,
		grantId: current.id,
		payrollEmployeeId,
		action: AuditAction.PAYROLL_ACCESS_GRANT_CHANGED,
		from: currentScope,
		to: nextScope,
	});
	return { grantId: current.id, outcome: "changed" };
}

/** Sets an active grant inactive. Refuses grants that are already revoked or belong elsewhere. */
export async function revokePayrollAccessGrant(
	tx: PayrollAccessTransaction,
	input: { organizationId: string; actorUserId: string; grantId: string },
): Promise<{ grantId: string; payrollEmployeeId: string }> {
	const { organizationId, actorUserId } = input;
	const grantId = validateId(input.grantId, "grantId");
	const notFound = new NotFoundError({
		message: "Payroll access grant not found",
		entityType: "payroll_access_grant",
		entityId: grantId,
	});
	if (!isUuid(grantId)) throw notFound;

	const [grant] = await tx
		.select({
			id: payrollAccessGrant.id,
			payrollEmployeeId: payrollAccessGrant.payrollEmployeeId,
			scope: payrollAccessGrant.scope,
		})
		.from(payrollAccessGrant)
		.where(
			and(
				eq(payrollAccessGrant.id, grantId),
				eq(payrollAccessGrant.organizationId, organizationId),
				eq(payrollAccessGrant.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	if (!grant) throw notFound;

	await revokeLockedGrant(tx, { organizationId, actorUserId, grant, metadata: null });
	return { grantId: grant.id, payrollEmployeeId: grant.payrollEmployeeId };
}

/**
 * Revokes the active grant the employee holds, if any, recording `auditMetadata` on the
 * audit entry. Offboarding (#750) calls it inside the departure's transaction. Grants
 * that only name the employee in their scope stay as they are.
 */
export async function revokePayrollAccessGrantHeldBy(
	tx: PayrollAccessTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		payrollEmployeeId: string;
		auditMetadata: Record<string, unknown>;
	},
): Promise<void> {
	const { organizationId, actorUserId } = input;
	const [grant] = await tx
		.select({
			id: payrollAccessGrant.id,
			payrollEmployeeId: payrollAccessGrant.payrollEmployeeId,
			scope: payrollAccessGrant.scope,
		})
		.from(payrollAccessGrant)
		.where(
			and(
				eq(payrollAccessGrant.organizationId, organizationId),
				eq(payrollAccessGrant.payrollEmployeeId, input.payrollEmployeeId),
				eq(payrollAccessGrant.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	if (!grant) return;

	await revokeLockedGrant(tx, { organizationId, actorUserId, grant, metadata: input.auditMetadata });
}

async function revokeLockedGrant(
	tx: PayrollAccessTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grant: { id: string; payrollEmployeeId: string; scope: string };
		metadata: Record<string, unknown> | null;
	},
): Promise<void> {
	const { organizationId, actorUserId, grant } = input;
	const scope = await readGrantScope(tx, organizationId, grant);
	await tx
		.update(payrollAccessGrant)
		.set({ isActive: false, updatedBy: actorUserId })
		.where(
			and(
				eq(payrollAccessGrant.id, grant.id),
				eq(payrollAccessGrant.organizationId, organizationId),
			),
		);
	await writeGrantAudit(tx, {
		organizationId,
		actorUserId,
		grantId: grant.id,
		payrollEmployeeId: grant.payrollEmployeeId,
		action: AuditAction.PAYROLL_ACCESS_GRANT_REVOKED,
		from: scope,
		to: null,
		metadata: input.metadata,
	});
}

async function readGrantScope(
	tx: PayrollAccessTransaction,
	organizationId: string,
	grant: { id: string; scope: string },
): Promise<PayrollAccessScope> {
	const [teamRows, employeeRows] = await Promise.all([
		tx
			.select({ teamId: payrollAccessTeam.teamId })
			.from(payrollAccessTeam)
			.where(
				and(
					eq(payrollAccessTeam.organizationId, organizationId),
					eq(payrollAccessTeam.grantId, grant.id),
				),
			),
		tx
			.select({ employeeId: payrollAccessEmployee.employeeId })
			.from(payrollAccessEmployee)
			.where(
				and(
					eq(payrollAccessEmployee.organizationId, organizationId),
					eq(payrollAccessEmployee.grantId, grant.id),
				),
			),
	]);

	return {
		scope: grant.scope === "all" ? "all" : "specific",
		teamIds: teamRows.map((row) => row.teamId),
		employeeIds: employeeRows.map((row) => row.employeeId),
	};
}

async function insertScopeRows(
	tx: PayrollAccessTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grantId: string;
		teamIds: string[];
		employeeIds: string[];
	},
): Promise<void> {
	const { organizationId, actorUserId, grantId } = input;
	if (input.teamIds.length > 0) {
		await tx
			.insert(payrollAccessTeam)
			.values(
				input.teamIds.map((teamId) => ({
					organizationId,
					grantId,
					teamId,
					createdBy: actorUserId,
				})),
			);
	}
	if (input.employeeIds.length > 0) {
		await tx.insert(payrollAccessEmployee).values(
			input.employeeIds.map((employeeId) => ({
				organizationId,
				grantId,
				employeeId,
				createdBy: actorUserId,
			})),
		);
	}
}

async function writeGrantAudit(
	tx: PayrollAccessTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grantId: string;
		payrollEmployeeId: string;
		action: AuditAction;
		from: PayrollAccessScope | null;
		to: PayrollAccessScope | null;
		metadata?: Record<string, unknown> | null;
	},
): Promise<void> {
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "payroll_access_grant",
		entityId: input.grantId,
		action: input.action,
		performedBy: input.actorUserId,
		employeeId: input.payrollEmployeeId,
		changes: JSON.stringify(payrollAccessGrantAuditChanges(input.from, input.to)),
		metadata: input.metadata ? JSON.stringify(input.metadata) : null,
	});
}

function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}
