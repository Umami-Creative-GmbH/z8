"use server";
import { Effect } from "effect";
import {
	previewVacationReconciliation,
	withReviewedVacationReconciliation,
} from "@/lib/absences/vacation-reconciliation";
import { historicalVacationRefusalOf } from "@/lib/absences/historical-vacation";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
export async function previewHistoricalVacationReconciliation(input: unknown) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = yield* auth.getSession();
			const organizationId = session.session.activeOrganizationId;
			if (!organizationId)
				return yield* Effect.fail(
					new ValidationError({
						message:
							"Select an organization before reviewing historical vacation.",
					}),
				);
			yield* auth.getSession(organizationId);
			const service = yield* DatabaseService;
			return yield* service
				.query("vacation.previewReconciliation", () =>
					service.db.transaction((tx) =>
						previewVacationReconciliation(
							tx,
							organizationId,
							session.user.id,
							input,
						),
					),
				)
				.pipe(
					Effect.mapError((error) => {
						const refusal = historicalVacationRefusalOf(error);
						return refusal
							? new ValidationError({
									message: refusal.message,
									refusal: refusal.refusal,
								})
							: error;
					}),
				);
		}),
	);
}

export async function getHistoricalImportReviewContext(batchId: string) {
	const { requireOrgAdminSettingsAccess } = await import("@/lib/auth-helpers");
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const { db } = await import("@/db");
	const { and, eq, inArray } = await import("drizzle-orm");
	const { importBatch, importStagedRow, absenceCategory } = await import(
		"@/db/schema"
	);
	const batch = await db.query.importBatch.findFirst({
		where: and(
			eq(importBatch.id, batchId),
			eq(importBatch.organizationId, organizationId),
		),
	});
	if (!batch || batch.provider === "accounting")
		throw new Error("Absence import not found.");
	const [rows, categories] = await Promise.all([
		db
			.select()
			.from(importStagedRow)
			.where(
				and(
					eq(importStagedRow.organizationId, organizationId),
					eq(importStagedRow.batchId, batchId),
					eq(importStagedRow.entityType, "absence"),
					inArray(importStagedRow.rowStatus, [
						"accepted",
						"blocked",
						"commit_failed",
					]),
				),
			),
		db
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
	]);
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
}
export async function commitHistoricalVacationImport(
	proof: import("@/lib/absences/vacation-reconciliation-types").ReconciliationProof,
) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = yield* auth.getSession();
			const organizationId = session.session.activeOrganizationId;
			if (!organizationId)
				return yield* Effect.fail(
					new ValidationError({ message: "Select an organization." }),
				);
			yield* auth.getSession(organizationId);
			const service = yield* DatabaseService;
			const { and, eq } = yield* Effect.promise(() => import("drizzle-orm"));
			const { importBatch, importBatchJob } = yield* Effect.promise(
				() => import("@/db/schema"),
			);
			const data = yield* service
				.query("vacation.queueReconciledImport", () =>
					service.db.transaction((tx) =>
						withReviewedVacationReconciliation(
							tx,
							{ organizationId, actorUserId: session.user.id, proof },
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
												.set({
													status: "queued",
													errorMessage: null,
													completedAt: null,
												})
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
									.set({ status: "committing", committedBy: session.user.id })
									.where(
										and(
											eq(importBatch.id, plan.batchId),
											eq(importBatch.organizationId, organizationId),
										),
									);
								return {
									type: "import-review-commit" as const,
									batchId: plan.batchId,
									jobId: job.id,
									organizationId,
									entityType: "absence" as const,
									committedBy: session.user.id,
									historicalReconciliation: proof,
								};
							},
						),
					),
				)
				.pipe(
					Effect.mapError((error) => {
						const refusal = historicalVacationRefusalOf(error);
						return refusal
							? new ValidationError({
									message: refusal.message,
									refusal: refusal.refusal,
								})
							: error;
					}),
				);
			const { enqueueImportCommitJob } = yield* Effect.promise(
				() => import("@/lib/import-review/queue"),
			);
			yield* Effect.promise(() => enqueueImportCommitJob(data));
			return { jobId: data.jobId };
		}),
	);
}
