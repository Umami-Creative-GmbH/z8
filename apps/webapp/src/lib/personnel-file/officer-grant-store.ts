import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	auditLog,
	employee,
	personnelFileOfficerEmployee,
	personnelFileOfficerGrant,
	personnelFileOfficerTeam,
	team,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { validateId, validateIdList } from "@/lib/payroll-access/grant-scope";
import {
	buildValidatedPersonnelFileOfficerGrant,
	diffPersonnelFileOfficerGrant,
	normalizeCategories,
	type PersonnelFileOfficerGrantValues,
	personnelFileOfficerGrantAuditChanges,
	type SavePersonnelFileOfficerGrantInput,
} from "./officer-grant";

/**
 * Reads and writes of personnel file officer grants (#866), like expense
 * officer grants (#747): each write runs inside the caller's transaction,
 * locks the officer's active grant and records an audit entry with the old
 * and new scope and categories in the same transaction. A revoked grant stays
 * inactive with the scope it had; a later grant for the same officer is a new
 * row.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Writes run in the caller's transaction, including a departure's work transaction. */
type GrantTransaction = Pick<Transaction, "select" | "insert" | "update" | "delete">;
type Executor = Database | GrantTransaction | Pick<Transaction, "select">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PersonnelFileOfficerGrantRecord extends PersonnelFileOfficerGrantValues {
	id: string;
	officerEmployeeId: string;
}

/** An active officer who still works for the organization, with their grant. */
export interface ActivePersonnelFileOfficer {
	userId: string;
	grant: PersonnelFileOfficerGrantRecord;
}

type GrantRow = Pick<
	typeof personnelFileOfficerGrant.$inferSelect,
	"id" | "officerEmployeeId" | "scope" | "categories"
>;

function grantColumns() {
	return {
		id: personnelFileOfficerGrant.id,
		officerEmployeeId: personnelFileOfficerGrant.officerEmployeeId,
		scope: personnelFileOfficerGrant.scope,
		categories: personnelFileOfficerGrant.categories,
	};
}

function activeOfficerJoin() {
	return and(
		eq(employee.id, personnelFileOfficerGrant.officerEmployeeId),
		eq(employee.organizationId, personnelFileOfficerGrant.organizationId),
		eq(employee.isActive, true),
	);
}

/** The active grants of the organization with their teams and named employees. */
export async function listActivePersonnelFileOfficerGrants(
	database: Executor,
	input: { organizationId: string },
): Promise<PersonnelFileOfficerGrantRecord[]> {
	const grants = await database
		.select(grantColumns())
		.from(personnelFileOfficerGrant)
		.where(
			and(
				eq(personnelFileOfficerGrant.organizationId, input.organizationId),
				eq(personnelFileOfficerGrant.isActive, true),
			),
		)
		.orderBy(personnelFileOfficerGrant.createdAt, personnelFileOfficerGrant.id);
	return withScopeRows(database, input.organizationId, grants);
}

/**
 * The grant an officer holds now, or null. A departed officer holds none,
 * even before offboarding revokes the grant.
 */
export async function loadActivePersonnelFileOfficerGrant(
	database: Executor,
	input: { organizationId: string; officerEmployeeId: string },
): Promise<PersonnelFileOfficerGrantRecord | null> {
	const grants = await database
		.select(grantColumns())
		.from(personnelFileOfficerGrant)
		.innerJoin(employee, activeOfficerJoin())
		.where(
			and(
				eq(personnelFileOfficerGrant.organizationId, input.organizationId),
				eq(personnelFileOfficerGrant.officerEmployeeId, input.officerEmployeeId),
				eq(personnelFileOfficerGrant.isActive, true),
			),
		)
		.limit(1);
	const [grant] = await withScopeRows(database, input.organizationId, grants);
	return grant ?? null;
}

/**
 * Every active officer of the organization whose employee profile is still
 * active, with their user. Callers still apply the departure cutoff where it
 * matters (see `listPersonnelFileNotificationRecipients`).
 */
export async function listActivePersonnelFileOfficers(
	database: Executor,
	input: { organizationId: string },
): Promise<ActivePersonnelFileOfficer[]> {
	const rows = await database
		.select({ ...grantColumns(), userId: employee.userId })
		.from(personnelFileOfficerGrant)
		.innerJoin(employee, activeOfficerJoin())
		.where(
			and(
				eq(personnelFileOfficerGrant.organizationId, input.organizationId),
				eq(personnelFileOfficerGrant.isActive, true),
			),
		)
		.orderBy(personnelFileOfficerGrant.createdAt, personnelFileOfficerGrant.id);
	const grants = await withScopeRows(database, input.organizationId, rows);
	return rows.flatMap((row, index) => {
		const grant = grants[index];
		return grant ? [{ userId: row.userId, grant }] : [];
	});
}

async function withScopeRows(
	database: Executor,
	organizationId: string,
	grants: GrantRow[],
): Promise<PersonnelFileOfficerGrantRecord[]> {
	if (grants.length === 0) return [];
	const grantIds = grants.map((grant) => grant.id);
	const [teamRows, employeeRows] = await Promise.all([
		database
			.select({
				grantId: personnelFileOfficerTeam.grantId,
				teamId: personnelFileOfficerTeam.teamId,
			})
			.from(personnelFileOfficerTeam)
			.where(
				and(
					eq(personnelFileOfficerTeam.organizationId, organizationId),
					inArray(personnelFileOfficerTeam.grantId, grantIds),
				),
			),
		database
			.select({
				grantId: personnelFileOfficerEmployee.grantId,
				employeeId: personnelFileOfficerEmployee.employeeId,
			})
			.from(personnelFileOfficerEmployee)
			.where(
				and(
					eq(personnelFileOfficerEmployee.organizationId, organizationId),
					inArray(personnelFileOfficerEmployee.grantId, grantIds),
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
		categories: normalizeCategories(grant.categories),
	}));
}

export async function savePersonnelFileOfficerGrant(
	tx: GrantTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grant: SavePersonnelFileOfficerGrantInput;
	},
): Promise<{ grantId: string; outcome: "created" | "changed" | "unchanged" }> {
	const { organizationId, actorUserId } = input;
	if (!input.grant || typeof input.grant !== "object") {
		throw new ValidationError({ message: "Personnel file officer input is required" });
	}
	const officerEmployeeId = validateId(input.grant.officerEmployeeId, "officerEmployeeId");
	const requestedTeamIds = validateIdList(input.grant.teamIds, "teamIds");
	const requestedEmployeeIds = validateIdList(input.grant.employeeIds, "employeeIds");
	if (![officerEmployeeId, ...requestedTeamIds, ...requestedEmployeeIds].every(isUuid)) {
		throw new ValidationError({ message: "Personnel file officer IDs must be valid" });
	}

	const [current] = await tx
		.select(grantColumns())
		.from(personnelFileOfficerGrant)
		.where(
			and(
				eq(personnelFileOfficerGrant.organizationId, organizationId),
				eq(personnelFileOfficerGrant.officerEmployeeId, officerEmployeeId),
				eq(personnelFileOfficerGrant.isActive, true),
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
	const validated = buildValidatedPersonnelFileOfficerGrant(input.grant, {
		activeEmployeeIds: employeeRows.filter((row) => row.isActive).map((row) => row.id),
		organizationEmployeeIds: employeeRows.map((row) => row.id),
		organizationTeamIds: teamRows.map((row) => row.id),
	});
	const next: PersonnelFileOfficerGrantValues = {
		scope: validated.scope,
		teamIds: validated.teamIds,
		employeeIds: validated.employeeIds,
		categories: validated.categories,
	};

	if (!currentGrant) {
		const [inserted] = await tx
			.insert(personnelFileOfficerGrant)
			.values({
				organizationId,
				officerEmployeeId,
				scope: next.scope,
				categories: next.categories,
				createdBy: actorUserId,
				updatedBy: actorUserId,
			})
			.returning({ id: personnelFileOfficerGrant.id });
		if (!inserted) {
			throw new DatabaseError({
				message: "Failed to create the personnel file officer grant",
				operation: "insert",
				table: "personnel_file_officer_grant",
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
			action: AuditAction.PERSONNEL_FILE_GRANT_CREATED,
			from: null,
			to: next,
		});
		return { grantId: inserted.id, outcome: "created" };
	}

	const diff = diffPersonnelFileOfficerGrant(currentGrant, next);
	if (!diff.changed) return { grantId: currentGrant.id, outcome: "unchanged" };

	await tx
		.update(personnelFileOfficerGrant)
		.set({ scope: next.scope, categories: next.categories, updatedBy: actorUserId })
		.where(
			and(
				eq(personnelFileOfficerGrant.id, currentGrant.id),
				eq(personnelFileOfficerGrant.organizationId, organizationId),
			),
		);
	if (diff.removedTeamIds.length > 0) {
		await tx
			.delete(personnelFileOfficerTeam)
			.where(
				and(
					eq(personnelFileOfficerTeam.organizationId, organizationId),
					eq(personnelFileOfficerTeam.grantId, currentGrant.id),
					inArray(personnelFileOfficerTeam.teamId, diff.removedTeamIds),
				),
			);
	}
	if (diff.removedEmployeeIds.length > 0) {
		await tx
			.delete(personnelFileOfficerEmployee)
			.where(
				and(
					eq(personnelFileOfficerEmployee.organizationId, organizationId),
					eq(personnelFileOfficerEmployee.grantId, currentGrant.id),
					inArray(personnelFileOfficerEmployee.employeeId, diff.removedEmployeeIds),
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
		action: AuditAction.PERSONNEL_FILE_GRANT_CHANGED,
		from: currentGrant,
		to: next,
	});
	return { grantId: currentGrant.id, outcome: "changed" };
}

/** Sets an active grant inactive. Refuses grants that are already revoked or belong elsewhere. */
export async function revokePersonnelFileOfficerGrant(
	tx: GrantTransaction,
	input: { organizationId: string; actorUserId: string; grantId: string },
): Promise<{ grantId: string; officerEmployeeId: string }> {
	const { organizationId, actorUserId } = input;
	const grantId = validateId(input.grantId, "grantId");
	const notFound = new NotFoundError({
		message: "Personnel file officer grant not found",
		entityType: "personnel_file_officer_grant",
		entityId: grantId,
	});
	if (!isUuid(grantId)) throw notFound;

	const [row] = await tx
		.select(grantColumns())
		.from(personnelFileOfficerGrant)
		.where(
			and(
				eq(personnelFileOfficerGrant.id, grantId),
				eq(personnelFileOfficerGrant.organizationId, organizationId),
				eq(personnelFileOfficerGrant.isActive, true),
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
 * `auditMetadata` on the audit entry. Offboarding calls it inside the
 * departure's transaction. Grants that only name the employee in their scope
 * stay, so their personnel file can still be managed.
 */
export async function revokePersonnelFileOfficerGrantHeldBy(
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
		.select(grantColumns())
		.from(personnelFileOfficerGrant)
		.where(
			and(
				eq(personnelFileOfficerGrant.organizationId, organizationId),
				eq(personnelFileOfficerGrant.officerEmployeeId, input.officerEmployeeId),
				eq(personnelFileOfficerGrant.isActive, true),
			),
		)
		.limit(1)
		.for("update");
	const [grant] = row ? await withScopeRows(tx, organizationId, [row]) : [];
	if (!grant) return;

	await revokeLockedGrant(tx, {
		organizationId,
		actorUserId,
		grant,
		metadata: input.auditMetadata,
	});
}

async function revokeLockedGrant(
	tx: GrantTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grant: PersonnelFileOfficerGrantRecord;
		metadata: Record<string, unknown> | null;
	},
): Promise<void> {
	const { organizationId, actorUserId, grant } = input;
	await tx
		.update(personnelFileOfficerGrant)
		.set({ isActive: false, updatedBy: actorUserId })
		.where(
			and(
				eq(personnelFileOfficerGrant.id, grant.id),
				eq(personnelFileOfficerGrant.organizationId, organizationId),
			),
		);
	await writeGrantAudit(tx, {
		organizationId,
		actorUserId,
		grantId: grant.id,
		officerEmployeeId: grant.officerEmployeeId,
		action: AuditAction.PERSONNEL_FILE_GRANT_REVOKED,
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
		await tx.insert(personnelFileOfficerTeam).values(
			input.teamIds.map((teamId) => ({
				organizationId,
				grantId,
				teamId,
				createdBy: actorUserId,
			})),
		);
	}
	if (input.employeeIds.length > 0) {
		await tx.insert(personnelFileOfficerEmployee).values(
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
		from: PersonnelFileOfficerGrantValues | null;
		to: PersonnelFileOfficerGrantValues | null;
		metadata?: Record<string, unknown> | null;
	},
): Promise<void> {
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "personnel_file_officer_grant",
		entityId: input.grantId,
		action: input.action,
		performedBy: input.actorUserId,
		employeeId: input.officerEmployeeId,
		changes: JSON.stringify(personnelFileOfficerGrantAuditChanges(input.from, input.to)),
		metadata: input.metadata ? JSON.stringify(input.metadata) : null,
	});
}

function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}
