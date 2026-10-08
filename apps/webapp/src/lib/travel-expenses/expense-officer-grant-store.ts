import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	auditLog,
	employee,
	expenseOfficerEmployee,
	expenseOfficerGrant,
	expenseOfficerTeam,
	team,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { validateId, validateIdList } from "@/lib/payroll-access/grant-scope";
import {
	buildValidatedExpenseOfficerGrant,
	diffExpenseOfficerGrant,
	type ExpenseOfficerGrantValues,
	expenseOfficerGrantAuditChanges,
	type SaveExpenseOfficerGrantInput,
} from "./expense-officer-grant";

/**
 * Reads and writes of expense officer grants (#747), like payroll access
 * grants (#749): each write runs inside the caller's transaction, locks the
 * officer's active grant and records an audit entry with the old and new scope
 * and capabilities in the same transaction. A revoked grant stays inactive
 * with the scope it had; a later grant for the same officer is a new row.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Writes run in the caller's transaction, including a departure's work transaction (#750). */
type GrantTransaction = Pick<Transaction, "select" | "insert" | "update" | "delete">;
type Executor = Database | GrantTransaction;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExpenseOfficerGrantRecord extends ExpenseOfficerGrantValues {
	id: string;
	officerEmployeeId: string;
}

type GrantRow = Pick<
	typeof expenseOfficerGrant.$inferSelect,
	"id" | "officerEmployeeId" | "scope" | "canExport" | "canRecordReimbursements"
>;

const grantColumns = {
	id: expenseOfficerGrant.id,
	officerEmployeeId: expenseOfficerGrant.officerEmployeeId,
	scope: expenseOfficerGrant.scope,
	canExport: expenseOfficerGrant.canExport,
	canRecordReimbursements: expenseOfficerGrant.canRecordReimbursements,
};

/** The active grants of the organization with their teams and named employees. */
export async function listActiveExpenseOfficerGrants(
	database: Executor,
	input: { organizationId: string },
): Promise<ExpenseOfficerGrantRecord[]> {
	const grants = await database
		.select(grantColumns)
		.from(expenseOfficerGrant)
		.where(
			and(
				eq(expenseOfficerGrant.organizationId, input.organizationId),
				eq(expenseOfficerGrant.isActive, true),
			),
		)
		.orderBy(expenseOfficerGrant.createdAt, expenseOfficerGrant.id);
	return withScopeRows(database, input.organizationId, grants);
}

/**
 * The access an officer holds now: their active grant, or null. A departed
 * officer holds none, even before offboarding revokes the grant (#750).
 */
export async function loadActiveExpenseOfficerGrant(
	database: Executor,
	input: { organizationId: string; officerEmployeeId: string },
): Promise<ExpenseOfficerGrantRecord | null> {
	const grants = await database
		.select(grantColumns)
		.from(expenseOfficerGrant)
		.innerJoin(
			employee,
			and(
				eq(employee.id, expenseOfficerGrant.officerEmployeeId),
				eq(employee.organizationId, expenseOfficerGrant.organizationId),
				eq(employee.isActive, true),
			),
		)
		.where(
			and(
				eq(expenseOfficerGrant.organizationId, input.organizationId),
				eq(expenseOfficerGrant.officerEmployeeId, input.officerEmployeeId),
				eq(expenseOfficerGrant.isActive, true),
			),
		)
		.limit(1);
	const [grant] = await withScopeRows(database, input.organizationId, grants);
	return grant ?? null;
}

async function withScopeRows(
	database: Executor,
	organizationId: string,
	grants: GrantRow[],
): Promise<ExpenseOfficerGrantRecord[]> {
	if (grants.length === 0) return [];
	const grantIds = grants.map((grant) => grant.id);
	const [teamRows, employeeRows] = await Promise.all([
		database
			.select({ grantId: expenseOfficerTeam.grantId, teamId: expenseOfficerTeam.teamId })
			.from(expenseOfficerTeam)
			.where(
				and(
					eq(expenseOfficerTeam.organizationId, organizationId),
					inArray(expenseOfficerTeam.grantId, grantIds),
				),
			),
		database
			.select({
				grantId: expenseOfficerEmployee.grantId,
				employeeId: expenseOfficerEmployee.employeeId,
			})
			.from(expenseOfficerEmployee)
			.where(
				and(
					eq(expenseOfficerEmployee.organizationId, organizationId),
					inArray(expenseOfficerEmployee.grantId, grantIds),
				),
			),
	]);
	return grants.map((grant) => ({
		id: grant.id,
		officerEmployeeId: grant.officerEmployeeId,
		scope: grant.scope === "all" ? "all" : "specific",
		teamIds: teamRows.flatMap((row) => (row.grantId === grant.id ? [row.teamId] : [])).toSorted(),
		employeeIds: employeeRows
			.flatMap((row) => (row.grantId === grant.id ? [row.employeeId] : []))
			.toSorted(),
		canExport: grant.canExport,
		canRecordReimbursements: grant.canRecordReimbursements,
	}));
}

export async function saveExpenseOfficerGrant(
	tx: Transaction,
	input: { organizationId: string; actorUserId: string; grant: SaveExpenseOfficerGrantInput },
): Promise<{ grantId: string; outcome: "created" | "changed" | "unchanged" }> {
	const { organizationId, actorUserId } = input;
	if (!input.grant || typeof input.grant !== "object") {
		throw new ValidationError({ message: "Expense officer input is required" });
	}
	const officerEmployeeId = validateId(input.grant.officerEmployeeId, "officerEmployeeId");
	const requestedTeamIds = validateIdList(input.grant.teamIds, "teamIds");
	const requestedEmployeeIds = validateIdList(input.grant.employeeIds, "employeeIds");
	if (![officerEmployeeId, ...requestedTeamIds, ...requestedEmployeeIds].every(isUuid)) {
		throw new ValidationError({ message: "Expense officer IDs must be valid" });
	}

	const [current] = await tx
		.select(grantColumns)
		.from(expenseOfficerGrant)
		.where(
			and(
				eq(expenseOfficerGrant.organizationId, organizationId),
				eq(expenseOfficerGrant.officerEmployeeId, officerEmployeeId),
				eq(expenseOfficerGrant.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	const [currentGrant] = current ? await withScopeRows(tx, organizationId, [current]) : [];

	const [employeeRows, teamRows] = await Promise.all([
		tx
			.select({ id: employee.id, isActive: employee.isActive })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, organizationId),
					inArray(employee.id, [officerEmployeeId, ...requestedEmployeeIds]),
				),
			),
		requestedTeamIds.length > 0
			? tx
					.select({ id: team.id })
					.from(team)
					.where(and(eq(team.organizationId, organizationId), inArray(team.id, requestedTeamIds)))
			: Promise.resolve([]),
	]);
	const validated = buildValidatedExpenseOfficerGrant(input.grant, {
		activeEmployeeIds: employeeRows.filter((row) => row.isActive).map((row) => row.id),
		organizationEmployeeIds: employeeRows.map((row) => row.id),
		organizationTeamIds: teamRows.map((row) => row.id),
	});
	const next: ExpenseOfficerGrantValues = {
		scope: validated.scope,
		teamIds: validated.teamIds,
		employeeIds: validated.employeeIds,
		canExport: validated.canExport,
		canRecordReimbursements: validated.canRecordReimbursements,
	};

	if (!currentGrant) {
		const [inserted] = await tx
			.insert(expenseOfficerGrant)
			.values({
				organizationId,
				officerEmployeeId,
				scope: next.scope,
				canExport: next.canExport,
				canRecordReimbursements: next.canRecordReimbursements,
				createdBy: actorUserId,
				updatedBy: actorUserId,
			})
			.returning({ id: expenseOfficerGrant.id });
		if (!inserted) {
			throw new DatabaseError({
				message: "Failed to create the expense officer grant",
				operation: "insert",
				table: "expense_officer_grant",
			});
		}
		await insertScopeRows(tx, {
			organizationId,
			actorUserId,
			grantId: inserted.id,
			teamIds: next.teamIds,
			employeeIds: next.employeeIds,
		});
		await writeGrantAudit(tx, {
			organizationId,
			actorUserId,
			grantId: inserted.id,
			officerEmployeeId,
			action: AuditAction.EXPENSE_OFFICER_GRANT_CREATED,
			from: null,
			to: next,
		});
		return { grantId: inserted.id, outcome: "created" };
	}

	const diff = diffExpenseOfficerGrant(currentGrant, next);
	if (!diff.changed) return { grantId: currentGrant.id, outcome: "unchanged" };

	await tx
		.update(expenseOfficerGrant)
		.set({
			scope: next.scope,
			canExport: next.canExport,
			canRecordReimbursements: next.canRecordReimbursements,
			updatedBy: actorUserId,
		})
		.where(
			and(
				eq(expenseOfficerGrant.id, currentGrant.id),
				eq(expenseOfficerGrant.organizationId, organizationId),
			),
		);
	if (diff.removedTeamIds.length > 0) {
		await tx
			.delete(expenseOfficerTeam)
			.where(
				and(
					eq(expenseOfficerTeam.organizationId, organizationId),
					eq(expenseOfficerTeam.grantId, currentGrant.id),
					inArray(expenseOfficerTeam.teamId, diff.removedTeamIds),
				),
			);
	}
	if (diff.removedEmployeeIds.length > 0) {
		await tx
			.delete(expenseOfficerEmployee)
			.where(
				and(
					eq(expenseOfficerEmployee.organizationId, organizationId),
					eq(expenseOfficerEmployee.grantId, currentGrant.id),
					inArray(expenseOfficerEmployee.employeeId, diff.removedEmployeeIds),
				),
			);
	}
	await insertScopeRows(tx, {
		organizationId,
		actorUserId,
		grantId: currentGrant.id,
		teamIds: diff.addedTeamIds,
		employeeIds: diff.addedEmployeeIds,
	});
	await writeGrantAudit(tx, {
		organizationId,
		actorUserId,
		grantId: currentGrant.id,
		officerEmployeeId,
		action: AuditAction.EXPENSE_OFFICER_GRANT_CHANGED,
		from: currentGrant,
		to: next,
	});
	return { grantId: currentGrant.id, outcome: "changed" };
}

/** Sets an active grant inactive. Refuses grants that are already revoked or belong elsewhere. */
export async function revokeExpenseOfficerGrant(
	tx: Transaction,
	input: { organizationId: string; actorUserId: string; grantId: string },
): Promise<{ grantId: string; officerEmployeeId: string }> {
	const { organizationId, actorUserId } = input;
	const grantId = validateId(input.grantId, "grantId");
	const notFound = new NotFoundError({
		message: "Expense officer grant not found",
		entityType: "expense_officer_grant",
		entityId: grantId,
	});
	if (!isUuid(grantId)) throw notFound;

	const [row] = await tx
		.select(grantColumns)
		.from(expenseOfficerGrant)
		.where(
			and(
				eq(expenseOfficerGrant.id, grantId),
				eq(expenseOfficerGrant.organizationId, organizationId),
				eq(expenseOfficerGrant.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	if (!row) throw notFound;
	const [grant] = await withScopeRows(tx, organizationId, [row]);
	if (!grant) throw notFound;

	await revokeLockedGrant(tx, { organizationId, actorUserId, grant, metadata: null });
	return { grantId: grant.id, officerEmployeeId: grant.officerEmployeeId };
}

/**
 * Revokes the active grant the officer holds, if any, recording
 * `auditMetadata` on the audit entry. Offboarding (#750) calls it inside the
 * departure's transaction. Grants that only name the employee in their scope
 * stay, so their reports can still be reimbursed.
 */
export async function revokeExpenseOfficerGrantHeldBy(
	tx: GrantTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		officerEmployeeId: string;
		auditMetadata: Record<string, unknown>;
	},
): Promise<void> {
	const { organizationId, actorUserId } = input;
	const [row] = await tx
		.select(grantColumns)
		.from(expenseOfficerGrant)
		.where(
			and(
				eq(expenseOfficerGrant.organizationId, organizationId),
				eq(expenseOfficerGrant.officerEmployeeId, input.officerEmployeeId),
				eq(expenseOfficerGrant.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	const [grant] = row ? await withScopeRows(tx, organizationId, [row]) : [];
	if (!grant) return;

	await revokeLockedGrant(tx, { organizationId, actorUserId, grant, metadata: input.auditMetadata });
}

async function revokeLockedGrant(
	tx: GrantTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grant: ExpenseOfficerGrantRecord;
		metadata: Record<string, unknown> | null;
	},
): Promise<void> {
	const { organizationId, actorUserId, grant } = input;
	await tx
		.update(expenseOfficerGrant)
		.set({ isActive: false, updatedBy: actorUserId })
		.where(
			and(
				eq(expenseOfficerGrant.id, grant.id),
				eq(expenseOfficerGrant.organizationId, organizationId),
			),
		);
	await writeGrantAudit(tx, {
		organizationId,
		actorUserId,
		grantId: grant.id,
		officerEmployeeId: grant.officerEmployeeId,
		action: AuditAction.EXPENSE_OFFICER_GRANT_REVOKED,
		from: grant,
		to: null,
		metadata: input.metadata,
	});
}

async function insertScopeRows(
	tx: GrantTransaction,
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
			.insert(expenseOfficerTeam)
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
		await tx.insert(expenseOfficerEmployee).values(
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
	tx: GrantTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grantId: string;
		officerEmployeeId: string;
		action: AuditAction;
		from: ExpenseOfficerGrantValues | null;
		to: ExpenseOfficerGrantValues | null;
		metadata?: Record<string, unknown> | null;
	},
): Promise<void> {
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "expense_officer_grant",
		entityId: input.grantId,
		action: input.action,
		performedBy: input.actorUserId,
		employeeId: input.officerEmployeeId,
		changes: JSON.stringify(expenseOfficerGrantAuditChanges(input.from, input.to)),
		metadata: input.metadata ? JSON.stringify(input.metadata) : null,
	});
}

function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}
