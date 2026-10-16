import "server-only";
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { organizationVehicle } from "@/db/schema";
import {
	compareInstants,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type {
	VehiclePhotoRefusal,
	VehiclePhotoView,
} from "./vehicle-photo-types";
import {
	findPhoto,
	ownedPhotoUpload,
	type PhotoActor,
	photoView,
} from "./vehicle-photos";

export type ReconcilePhotoResult =
	| { ok: true; photo: VehiclePhotoView | null }
	| { ok: false; reason: VehiclePhotoRefusal };
/** Check a stable identity before retrying a possibly completed binary request. */
export async function reconcilePhotoUpload(
	database: typeof db,
	actor: PhotoActor,
	vehicleId: string,
	uploadId: string,
): Promise<ReconcilePhotoResult> {
	const intent = await ownedPhotoUpload(database, actor, vehicleId, uploadId);
	if (!intent) return { ok: false, reason: "upload_not_found" };
	const [vehicle] = await database
		.select({ archivedAt: organizationVehicle.archivedAt })
		.from(organizationVehicle)
		.where(
			and(
				eq(organizationVehicle.organizationId, actor.organizationId),
				eq(organizationVehicle.id, vehicleId),
			),
		);
	if (!vehicle) return { ok: false, reason: "vehicle_not_found" };
	const saved = await findPhoto(database, actor, vehicleId, uploadId);
	if (saved) return { ok: true, photo: photoView(saved) };
	if (
		intent.status !== "pending" ||
		compareInstants(
			instantFromDate(intent.nextAttemptAt),
			systemClock.nowInstant(),
		) <= 0
	)
		return { ok: false, reason: "upload_expired" };
	if (vehicle.archivedAt) return { ok: false, reason: "vehicle_archived" };
	return { ok: true, photo: null };
}
