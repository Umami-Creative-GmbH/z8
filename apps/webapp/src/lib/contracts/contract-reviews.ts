import { and, desc, eq } from "drizzle-orm";
import { type ContractMigrationConflict, contractMigrationConflict } from "@/db/schema";
import type { ContractMigrationConflictStatus } from "@/db/schema/contract-types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

export async function listContractMigrationConflicts(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	options: { status?: ContractMigrationConflictStatus; employeeId?: string } = {},
): Promise<ContractMigrationConflict[]> {
	const conditions = [eq(contractMigrationConflict.organizationId, organizationId)];
	if (options.status) {
		conditions.push(eq(contractMigrationConflict.status, options.status));
	}
	if (options.employeeId) {
		conditions.push(eq(contractMigrationConflict.employeeId, options.employeeId));
	}

	return db
		.select()
		.from(contractMigrationConflict)
		.where(and(...conditions))
		.orderBy(desc(contractMigrationConflict.createdAt));
}

export async function resolveContractMigrationConflict(
	db: DatabaseClient,
	input: {
		organizationId: string;
		conflictId: string;
		actorUserId: string;
		status: "resolved" | "dismissed";
		resolutionNote?: string | null;
	},
): Promise<ContractMigrationConflict> {
	const [updated] = await db
		.update(contractMigrationConflict)
		.set({
			status: input.status,
			resolvedAt: currentTimestamp(),
			resolvedBy: input.actorUserId,
			resolutionNote: input.resolutionNote?.trim() || null,
		})
		.where(
			and(
				eq(contractMigrationConflict.id, input.conflictId),
				eq(contractMigrationConflict.organizationId, input.organizationId),
			),
		)
		.returning();

	if (!updated) {
		throw new NotFoundError({
			message: "Contract migration conflict not found",
			entityType: "contract_migration_conflict",
			entityId: input.conflictId,
		});
	}
	return updated;
}
