import { and, eq } from "drizzle-orm";
import { importStagedRow } from "@/db/schema";
import { importedWorkSourceKey } from "@/lib/time-tracking/record-imported-work";
import {
	runWorkTransaction,
	type WorkPlan,
	type WorkRoute,
	type WorkTransactionClient,
	type WorkTransactionScope,
} from "@/lib/time-tracking/work-transaction";
import type { ImportProvider } from "./types";

export interface ReviewedImportTransactionInput {
	organizationId: string;
	batchId: string;
	/** The staged work row; routing reads its mapping. */
	rowId: string;
	provider: ImportProvider;
	importerUserId: string;
}

/** Where a staged work row routes: its mapped employee and its provider source identity. */
export interface ReviewedImportRowRouting {
	employeeId: string;
	/** `importedWorkSourceKey` of the row's source. */
	sourceKey: string;
}

/** The routed row's mapping; null when the row no longer exists. */
export interface ReviewedImportRoute extends WorkRoute<ReviewedImportRowRouting | null> {
	snapshot: ReviewedImportRowRouting | null;
}

type StagedRowMapping = Pick<
	typeof importStagedRow.$inferSelect,
	"batchId" | "normalizedPayload" | "providerSourceId" | "sourcePayloadHash"
>;

export function reviewedImportRowRouting(
	row: StagedRowMapping,
	provider: ImportProvider,
): ReviewedImportRowRouting {
	const employeeId = row.normalizedPayload.employeeId;
	if (typeof employeeId !== "string" || employeeId.length === 0) {
		throw new Error("work_period import row requires a mapped employee before commit");
	}
	return {
		employeeId,
		sourceKey: importedWorkSourceKey({
			provider,
			batchId: row.batchId,
			entityType: "work_period",
			providerSourceId: row.providerSourceId,
			sourcePayloadHash: row.sourcePayloadHash,
		}),
	};
}

/**
 * Routes the staged row by its mapping, whatever its status: the importer's
 * access, the mapped employee (the only write target), and the provider source
 * identity, so the same source imported through two batches serializes
 * regardless of its employee mapping. The employee key replaces the import
 * worker's former `organization:employee` key.
 */
async function routeReviewedImport(
	db: WorkTransactionClient,
	input: ReviewedImportTransactionInput,
): Promise<ReviewedImportRoute> {
	const [row] = await db
		.select({
			batchId: importStagedRow.batchId,
			normalizedPayload: importStagedRow.normalizedPayload,
			providerSourceId: importStagedRow.providerSourceId,
			sourcePayloadHash: importStagedRow.sourcePayloadHash,
		})
		.from(importStagedRow)
		.where(
			and(
				eq(importStagedRow.id, input.rowId),
				eq(importStagedRow.batchId, input.batchId),
				eq(importStagedRow.organizationId, input.organizationId),
				eq(importStagedRow.entityType, "work_period"),
			),
		)
		.limit(1);
	const routing = row ? reviewedImportRowRouting(row, input.provider) : null;
	const employees = routing ? [routing.employeeId] : [];
	return {
		users: [input.importerUserId],
		employees,
		writeTargets: employees,
		sourceIdentities: routing
			? [["reviewed-import-source", input.organizationId, routing.sourceKey]]
			: [],
		snapshot: routing,
	};
}

export function reviewedImportPlan(
	input: ReviewedImportTransactionInput,
): WorkPlan<ReviewedImportRoute> {
	return { organizationId: input.organizationId, route: (db) => routeReviewedImport(db, input) };
}

/**
 * Work transaction for committing one reviewed work import row (#284). Imports
 * have no approval participation. The operation claims the staging row and must
 * call `scope.restart()` when the claimed row no longer maps to the routed scope.
 */
export function withReviewedImportTransaction<T>(
	input: ReviewedImportTransactionInput,
	operation: (scope: WorkTransactionScope<ReviewedImportRoute>) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(reviewedImportPlan(input), operation);
}
