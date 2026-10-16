import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	organizationVehiclePhoto as photo,
	organizationVehiclePhotoUpload as upload,
} from "@/db/schema";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { deletePrivateObjectVersions } from "@/lib/storage/export-s3-client";

/**
 * Holding each intent's row lock through object deletion serializes cleanup with
 * attachment. No expiring worker lease can race a slow storage write. Failures
 * back off forever; tombstones keep upload identities permanently consumed.
 */
export async function runVehiclePhotoCleanupJob() {
	const now = systemClock.nowInstant();
	const result = {
		success: true as const,
		claimed: 0,
		deleted: 0,
		released: 0,
		failed: 0,
		outstanding: 0,
	};
	await db.transaction(async (tx) => {
		const due = await tx
			.select()
			.from(upload)
			.where(
				and(
					or(
						eq(upload.status, "pending"),
						eq(upload.status, "cleanup_required"),
					),
					lte(upload.nextAttemptAt, dateFromInstant(now)),
				),
			)
			.orderBy(asc(upload.nextAttemptAt))
			.limit(100)
			.for("update", { skipLocked: true });
		result.claimed = due.length;
		for (const row of due) {
			const [attached] = await tx
				.select({ id: photo.id })
				.from(photo)
				.where(
					and(
						eq(photo.organizationId, row.organizationId),
						eq(photo.storageKey, row.storageKey),
					),
				);
			if (attached) {
				await tx
					.update(upload)
					.set({ status: "attached" })
					.where(eq(upload.id, row.id));
				result.released++;
				continue;
			}
			try {
				await deletePrivateObjectVersions({
					organizationId: row.organizationId,
					key: row.storageKey,
					bucket: row.storageBucket,
				});
				await tx
					.update(upload)
					.set({ status: "cleaned", lastError: null })
					.where(eq(upload.id, row.id));
				result.deleted++;
			} catch {
				await tx
					.update(upload)
					.set({
						status: "cleanup_required",
						attempts: row.attempts + 1,
						lastError: "Private photo storage cleanup failed",
						nextAttemptAt: dateFromInstant(
							now.add({
								seconds: Math.min(43200, 60 * 2 ** Math.min(row.attempts, 10)),
							}),
						),
					})
					.where(eq(upload.id, row.id));
				result.failed++;
			}
		}
	});
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(upload)
		.where(eq(upload.status, "cleanup_required"));
	result.outstanding = row.count;
	return result;
}
