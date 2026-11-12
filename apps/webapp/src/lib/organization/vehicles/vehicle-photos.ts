import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	organizationVehicle,
	organizationVehiclePhoto as photo,
	organizationVehiclePhotoUpload as upload,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import {
	MAX_VEHICLE_PHOTOS,
	VehiclePhotoRefusal,
	type VehiclePhotoRefusalCode,
	type VehiclePhotoView,
} from "./vehicle-photo-types";

type Database = typeof db;
export type PhotoTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
export interface PhotoActor {
	organizationId: string;
	userId: string;
}
export function photoView(row: typeof photo.$inferSelect): VehiclePhotoView {
	return {
		id: row.id,
		vehicleId: row.vehicleId,
		width: row.width,
		height: row.height,
		createdAt: row.createdAt.toISOString(),
		order: row.uploadOrder,
		imageUrl: `/api/organization/vehicles/${row.vehicleId}/photos/${row.id}`,
	};
}
const vehicleScope = (organizationId: string, vehicleId: string) =>
	and(
		eq(organizationVehicle.organizationId, organizationId),
		eq(organizationVehicle.id, vehicleId),
	);
export const photoScope = (
	organizationId: string,
	vehicleId: string,
	photoId?: string,
) =>
	and(
		eq(photo.organizationId, organizationId),
		eq(photo.vehicleId, vehicleId),
		photoId ? eq(photo.id, photoId) : undefined,
	);
const uploadScope = (actor: PhotoActor, vehicleId: string, id: string) =>
	and(
		eq(upload.organizationId, actor.organizationId),
		eq(upload.vehicleId, vehicleId),
		eq(upload.id, id),
		eq(upload.uploadedBy, actor.userId),
	);
/** The caller lost owner/admin access between the action's check and the photo transaction. */
function accessChanged(actor: PhotoActor) {
	return new AuthorizationError({
		message: "You do not have access to this setting",
		userId: actor.userId,
		resource: "vehiclePhotos",
	});
}
/** An upload identity of another user, vehicle or organization: not this caller's upload. */
function foreignUpload() {
	return new NotFoundError({
		message: "Upload not found",
		entityType: "vehicle_photo_upload",
	});
}
/** Recheck current membership inside the attachment transaction, after processing. */
async function currentActor(tx: PhotoTransaction, actor: PhotoActor) {
	const [membership] = await tx
		.select()
		.from(member)
		.where(
			and(
				eq(member.userId, actor.userId),
				eq(member.organizationId, actor.organizationId),
				eq(member.status, "approved"),
			),
		)
		.for("share");
	const [person] = await tx
		.select({ isActive: employee.isActive })
		.from(employee)
		.where(
			and(
				eq(employee.userId, actor.userId),
				eq(employee.organizationId, actor.organizationId),
			),
		)
		.for("share");
	return (
		membership &&
		(hasOrganizationRole(membership.role, "owner") ||
			hasOrganizationRole(membership.role, "admin")) &&
		person?.isActive !== false
	);
}
export async function listPhotos(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
) {
	const [vehicle] = await database
		.select()
		.from(organizationVehicle)
		.where(vehicleScope(actor.organizationId, vehicleId));
	if (!vehicle) throw new VehiclePhotoRefusal("vehicle_not_found");
	const rows = await database
		.select()
		.from(photo)
		.where(photoScope(actor.organizationId, vehicleId))
		.orderBy(asc(photo.uploadOrder), asc(photo.id));
	return { photos: rows.map(photoView), archived: vehicle.archivedAt !== null };
}
/**
 * Reserve one upload. Throws a `VehiclePhotoRefusal`, an `AuthorizationError`
 * on lost access or a `NotFoundError` on a foreign identity, as the batch does.
 */
export async function initiatePhotoUpload(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
): Promise<{ uploadId: string }> {
	const { uploadIds } = await initiatePhotoBatchUpload(database, actor, vehicleId, [
		randomUUID(),
	]);
	return { uploadId: uploadIds[0] };
}
/**
 * Reserve one complete ordered selection. Replaying its client-known identities is read-only.
 * A full gallery refuses with `photo_limit`, its details saying how many slots remain.
 */
export async function initiatePhotoBatchUpload(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	uploadIds: string[],
): Promise<{ uploadIds: string[] }> {
	return database.transaction(async (tx): Promise<{ uploadIds: string[] }> => {
		const [vehicle] = await tx
			.select()
			.from(organizationVehicle)
			.where(vehicleScope(actor.organizationId, vehicleId))
			.for("update");
		if (!(await currentActor(tx, actor))) throw accessChanged(actor);
		if (!vehicle) throw new VehiclePhotoRefusal("vehicle_not_found");
		const existing = await tx
			.select()
			.from(upload)
			.where(
				and(
					eq(upload.organizationId, actor.organizationId),
					inArray(upload.id, uploadIds),
				),
			);
		if (existing.length) {
			if (
				existing.length !== uploadIds.length ||
				existing.some(
					(intent) =>
						intent.vehicleId !== vehicleId ||
						intent.uploadedBy !== actor.userId,
				)
			)
				throw foreignUpload();
			return { uploadIds };
		}
		if (vehicle.archivedAt) throw new VehiclePhotoRefusal("vehicle_archived");
		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)::int` })
			.from(photo)
			.where(photoScope(actor.organizationId, vehicleId));
		if (count + uploadIds.length > MAX_VEHICLE_PHOTOS)
			throw new VehiclePhotoRefusal("photo_limit", {
				remaining: Math.max(0, MAX_VEHICLE_PHOTOS - count),
			});
		const [{ last }] = await tx
			.select({
				last: sql<number>`coalesce(max(${upload.uploadOrder}),0)::int`,
			})
			.from(upload)
			.where(
				and(
					eq(upload.organizationId, actor.organizationId),
					eq(upload.vehicleId, vehicleId),
				),
			);
		const now = systemClock.nowInstant();
		const inserted = await tx
			.insert(upload)
			.values(
				uploadIds.map((id, index) => ({
					id,
					organizationId: actor.organizationId,
					vehicleId,
					uploadedBy: actor.userId,
					uploadOrder: last + index + 1,
					storageKey: `vehicle-photos/${actor.organizationId}/${vehicleId}/${id}.webp`,
					createdAt: dateFromInstant(now),
					nextAttemptAt: dateFromInstant(now.add({ hours: 1 })),
				})),
			)
			.onConflictDoNothing({ target: upload.id })
			.returning({ id: upload.id });
		// A collision outside this scope must roll back every identity in the selection.
		if (inserted.length !== uploadIds.length) throw foreignUpload();
		return { uploadIds };
	});
}
export async function findPhoto(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	id: string,
) {
	const [row] = await database
		.select()
		.from(photo)
		.where(photoScope(actor.organizationId, vehicleId, id));
	return row;
}
export async function ownedPhotoUpload(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	id: string,
) {
	const [row] = await database
		.select()
		.from(upload)
		.where(uploadScope(actor, vehicleId, id));
	return row;
}
export async function rejectPhotoUpload(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	id: string,
	reason: string,
) {
	await database
		.update(upload)
		.set({
			status: "cleanup_required",
			nextAttemptAt: dateFromInstant(systemClock.nowInstant()),
			lastError: reason.slice(0, 500),
		})
		.where(
			and(uploadScope(actor, vehicleId, id), eq(upload.status, "pending")),
		);
}
/**
 * The upload route's outcome, sent as its HTTP body (not a server action
 * result). A refusal returns rather than throws, so the transaction commits
 * the intent's `cleanup_required` mark; `forbidden` becomes a 403.
 */
export type FinalizePhotoResult =
	| { ok: true; photo: VehiclePhotoView }
	| { ok: false; reason: VehiclePhotoRefusalCode | "forbidden" };
/**
 * Keep the vehicle then upload locks through the object write and attachment.
 * Cleanup takes the upload lock too: it cannot delete an in-flight/attached image.
 * If the write succeeds but the transaction crashes, the committed intent still
 * identifies its write-once key, including all versions, for abandonment cleanup.
 */
export async function finalizePhotoUpload(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	id: string,
	image: { bytes: Uint8Array; width: number; height: number },
	store: (key: string) => Promise<{ bucket: string; versionId: string | null }>,
): Promise<FinalizePhotoResult> {
	return database.transaction(async (tx) => {
		const [vehicle] = await tx
			.select()
			.from(organizationVehicle)
			.where(vehicleScope(actor.organizationId, vehicleId))
			.for("update");
		const [intent] = await tx
			.select()
			.from(upload)
			.where(uploadScope(actor, vehicleId, id))
			.for("update");
		if (!intent) return { ok: false, reason: "upload_not_found" };
		const refuse = async (
			reason: VehiclePhotoRefusalCode | "forbidden",
		): Promise<FinalizePhotoResult> => {
			if (intent.status !== "attached")
				await tx
					.update(upload)
					.set({
						status: "cleanup_required",
						nextAttemptAt: dateFromInstant(systemClock.nowInstant()),
						lastError: reason,
					})
					.where(eq(upload.id, id));
			return { ok: false, reason };
		};
		if (!(await currentActor(tx, actor))) return refuse("forbidden");
		if (!vehicle) return refuse("vehicle_not_found");
		const [existing] = await tx
			.select()
			.from(photo)
			.where(photoScope(actor.organizationId, vehicleId, id));
		if (existing) return { ok: true, photo: photoView(existing) };
		if (
			intent.status !== "pending" ||
			compareInstants(
				instantFromDate(intent.nextAttemptAt),
				systemClock.nowInstant(),
			) <= 0
		)
			return refuse("upload_expired");
		if (vehicle.archivedAt) return refuse("vehicle_archived");
		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)::int` })
			.from(photo)
			.where(photoScope(actor.organizationId, vehicleId));
		if (count >= MAX_VEHICLE_PHOTOS) return refuse("photo_limit");
		const stored = await store(intent.storageKey);
		const [row] = await tx
			.insert(photo)
			.values({
				id,
				organizationId: actor.organizationId,
				vehicleId,
				uploadedBy: actor.userId,
				uploadOrder: intent.uploadOrder,
				storageKey: intent.storageKey,
				storageBucket: stored.bucket,
				storageVersionId: stored.versionId,
				width: image.width,
				height: image.height,
				sizeBytes: image.bytes.byteLength,
			})
			.returning();
		await tx
			.update(upload)
			.set({
				status: "attached",
				storageBucket: stored.bucket,
				storageVersionId: stored.versionId,
			})
			.where(eq(upload.id, id));
		await tx.insert(auditLog).values({
			organizationId: actor.organizationId,
			entityType: "vehicle",
			entityId: vehicleId,
			performedBy: actor.userId,
			action: AuditAction.VEHICLE_PHOTO_ADDED,
			changes: JSON.stringify({
				photoId: id,
				width: row.width,
				height: row.height,
			}),
		});
		return { ok: true, photo: photoView(row) };
	});
}
/** Called inside the existing vehicle-delete transaction; refusal rolls this back. */
export async function queueVehiclePhotoDeletion(
	tx: PhotoTransaction,
	organizationId: string,
	vehicleId: string,
) {
	await tx
		.update(upload)
		.set({
			status: "cleanup_required",
			nextAttemptAt: dateFromInstant(systemClock.nowInstant()),
		})
		.where(
			and(
				eq(upload.organizationId, organizationId),
				eq(upload.vehicleId, vehicleId),
			),
		);
}

/** Pin the destination outside the attachment transaction, before any object write. */
export async function pinPhotoStorage(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	id: string,
	bucket: string,
) {
	const rows = await database
		.update(upload)
		.set({ storageBucket: bucket })
		.where(
			and(
				uploadScope(actor, vehicleId, id),
				eq(upload.status, "pending"),
				sql`(${upload.storageBucket} is null or ${upload.storageBucket}=${bucket})`,
			),
		)
		.returning({ id: upload.id });
	return rows.length === 1;
}
export async function notePhotoUploadFailure(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	id: string,
) {
	await database
		.update(upload)
		.set({
			lastError: "Photo upload failed; retry or abandonment cleanup pending",
		})
		.where(
			and(uploadScope(actor, vehicleId, id), eq(upload.status, "pending")),
		);
}

/**
 * The vehicle lock serializes removal with attachment and vehicle lifecycle writes.
 * `removed: false` is an already removed photo. Refusals throw before any write.
 */
export async function removePhoto(
	database: Database,
	actor: PhotoActor,
	vehicleId: string,
	photoId: string,
): Promise<{ removed: boolean }> {
	return database.transaction(async (tx) => {
		const [vehicle] = await tx
			.select()
			.from(organizationVehicle)
			.where(vehicleScope(actor.organizationId, vehicleId))
			.for("update");
		if (!(await currentActor(tx, actor))) throw accessChanged(actor);
		if (!vehicle) throw new VehiclePhotoRefusal("vehicle_not_found");
		if (vehicle.archivedAt) throw new VehiclePhotoRefusal("vehicle_archived");
		const [existing] = await tx
			.select()
			.from(photo)
			.where(
				and(
					eq(photo.organizationId, actor.organizationId),
					eq(photo.vehicleId, vehicleId),
					eq(photo.id, photoId),
				),
			);
		if (!existing) {
			const [removed] = await tx
				.select({ status: upload.status })
				.from(upload)
				.where(
					and(
						eq(upload.organizationId, actor.organizationId),
						eq(upload.vehicleId, vehicleId),
						eq(upload.id, photoId),
					),
				);
			if (removed && ["cleanup_required", "cleaned"].includes(removed.status))
				return { removed: false };
			throw new VehiclePhotoRefusal("photo_not_found");
		}
		// The database DELETE trigger retains the object identity in the durable ledger.
		await tx
			.delete(photo)
			.where(
				and(
					eq(photo.organizationId, actor.organizationId),
					eq(photo.vehicleId, vehicleId),
					eq(photo.id, photoId),
				),
			);
		await tx.insert(auditLog).values({
			organizationId: actor.organizationId,
			entityType: "vehicle",
			entityId: vehicleId,
			performedBy: actor.userId,
			action: AuditAction.VEHICLE_PHOTO_REMOVED,
			changes: JSON.stringify({ photoId }),
		});
		return { removed: true };
	});
}
