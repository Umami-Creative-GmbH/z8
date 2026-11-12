"use server";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { absenceCategory, importBatch, importBatchJob, importStagedRow } from "@/db/schema";
import { historicalVacationRefusalOf } from "@/lib/absences/historical-vacation";
import {
	previewVacationReconciliation,
	withReviewedVacationReconciliation,
} from "@/lib/absences/vacation-reconciliation";
import {
	reconciliationInputSchema,
	reconciliationProofSchema,
} from "@/lib/absences/vacation-reconciliation-types";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";

function refusalOf(error: unknown) {
	const refusal = historicalVacationRefusalOf(error);
	return refusal ? new ValidationError({ message: refusal.message, refusal: refusal.refusal }) : null;
}

/**
 * Reviews a historical vacation reconciliation in the active organization. Any
 * member may ask; the reconciliation itself requires the administrator or
 * assigned-manager recording permission for the employee.
 */
export const previewHistoricalVacationReconciliation = organizationAction(
	{
		name: "vacation.previewReconciliation",
		requires: "member",
		schema: reconciliationInputSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* service
				.query("vacation.previewReconciliation", () =>
					service.db.transaction((tx) =>
						previewVacationReconciliation(tx, organizationId, actor.userId, input),
					),
				)
				.pipe(Effect.mapError((error) => refusalOf(error) ?? error));
		}),
);

/** The staged absence rows of an import batch and the categories to map them to. */
export const getHistoricalImportReviewContext = organizationAction(
	{ name: "vacation.historicalImportReviewContext", requires: "orgAdmin", schema: z.string().min(1) },
	({ organizationId, input: batchId }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			const batch = yield* service.query("vacation.historicalImportBatch", () =>
				service.db.query.importBatch.findFirst({
					where: and(eq(importBatch.id, batchId), eq(importBatch.organizationId, organizationId)),
				}),
			);
			if (!batch || batch.provider === "accounting") {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Absence import not found.",
						entityType: "import_batch",
						entityId: batchId,
					}),
				);
			}
			const [rows, categories] = yield* service.query("vacation.historicalImportRows", () =>
				Promise.all([
					service.db
						.select()
						.from(importStagedRow)
						.where(
							and(
								eq(importStagedRow.organizationId, organizationId),
								eq(importStagedRow.batchId, batchId),
								eq(importStagedRow.entityType, "absence"),
								inArray(importStagedRow.rowStatus, ["accepted", "blocked", "commit_failed"]),
							),
						),
					service.db
						.select({
							id: absenceCategory.id,
							name: absenceCategory.name,
							countsAgainstVacation: absenceCategory.countsAgainstVacation,
						})
						.from(absenceCategory)
						.where(
							and(
								eq(absenceCategory.organizationId, organizationId),
								eq(absenceCategory.isActive, true),
							),
						),
				]),
			);
			return {
				rows: rows
					.filter(
						(row) =>
							!row.commitHold &&
							(row.rowStatus === "accepted" ||
								row.commitError?.toLowerCase().includes("historical")),
					)
					.map((row) => ({
						id: row.id,
						providerSourceId: row.providerSourceId,
						employeeId: String(row.normalizedPayload.employeeId ?? ""),
						startsAt: String(row.normalizedPayload.startsAt ?? ""),
						endsAt: String(row.normalizedPayload.endsAt ?? ""),
						sourceCategory: String(
							row.normalizedPayload.absenceCategoryName ??
								row.normalizedPayload.absenceCategoryId ??
								row.normalizedPayload.categoryName ??
								"Unknown",
						),
					})),
				categories,
			};
		}),
);

/**
 * Queues the reviewed absence import. Like the preview, it needs membership here
 * and the recording permission the reviewed reconciliation proves.
 */
export const commitHistoricalVacationImport = organizationAction(
	{
		name: "vacation.commitReconciledImport",
		requires: "member",
		schema: reconciliationProofSchema,
	},
	({ actor, organizationId, input: proof }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			const data = yield* service
				.query("vacation.queueReconciledImport", () =>
					service.db.transaction((tx) =>
						withReviewedVacationReconciliation(
							tx,
							{ organizationId, actorUserId: actor.userId, proof },
							async (review) => {
								const plan = review.sourceState.input;
								if (plan.kind !== "import")
									throw new Error("The reviewed operation is not an import.");
								const [existing] = await tx
									.select()
									.from(importBatchJob)
									.where(
										and(
											eq(importBatchJob.organizationId, organizationId),
											eq(importBatchJob.batchId, plan.batchId),
											eq(importBatchJob.kind, "commit"),
											eq(importBatchJob.partitionKey, "commit:absence"),
										),
									)
									.for("update");
								if (existing?.status === "running")
									throw new Error(
										"The absence import is already running. Wait for its result before retrying.",
									);
								const job = existing
									? (
											await tx
												.update(importBatchJob)
												.set({ status: "queued", errorMessage: null, completedAt: null })
												.where(eq(importBatchJob.id, existing.id))
												.returning()
										)[0]
									: (
											await tx
												.insert(importBatchJob)
												.values({
													organizationId,
													batchId: plan.batchId,
													kind: "commit",
													entityType: "absence",
													partitionKey: "commit:absence",
												})
												.returning()
										)[0];
								await tx
									.update(importBatch)
									.set({ status: "committing", committedBy: actor.userId })
									.where(
										and(eq(importBatch.id, plan.batchId), eq(importBatch.organizationId, organizationId)),
									);
								return {
									type: "import-review-commit" as const,
									batchId: plan.batchId,
									jobId: job.id,
									organizationId,
									entityType: "absence" as const,
									committedBy: actor.userId,
									historicalReconciliation: proof,
								};
							},
						),
					),
				)
				.pipe(Effect.mapError((error) => refusalOf(error) ?? error));
			const { enqueueImportCommitJob } = yield* Effect.promise(
				() => import("@/lib/import-review/queue"),
			);
			yield* Effect.promise(() => enqueueImportCommitJob(data));
			return { jobId: data.jobId };
		}),
);