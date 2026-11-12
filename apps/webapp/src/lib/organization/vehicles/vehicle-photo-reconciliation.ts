import "server-only";
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { organizationVehicle } from "@/db/schema";
import {
	compareInstants,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	VehiclePhotoRefusal,
	type VehiclePhotoView,
} from "./vehicle-photo-types";
import {
	findPhoto,
	ownedPhotoUpload,
	type PhotoActor,
	photoView,
} from "./vehicle-photos";

/**
 * Check a stable identity before retrying a possibly completed binary request:
 * the saved photo, or null when the upload may be retried. A lost, expired or
 * blocked upload throws a `VehiclePhotoRefusal`.
 */
export async function reconcilePhotoUpload(
	database: typeof db,
	actor: PhotoActor,
	vehicleId: string,
	uploadId: string,
): Promise<{ photo: VehiclePhotoView | null }> {
	const intent = await ownedPhotoUpload(database, actor, vehicleId, uploadId);
	if (!intent) throw new VehiclePhotoRefusal("upload_not_found");
	const [vehicle] = await database
		.select({ archivedAt: organizationVehicle.archivedAt })
		.from(organizationVehicle)
		.where(
			and(
				eq(organizationVehicle.organizationId, actor.organizationId),
				eq(organizationVehicle.id, vehicleId),
			),
		);
	if (!vehicle) throw new VehiclePhotoRefusal("vehicle_not_found");
	const saved = await findPhoto(database, actor, vehicleId, uploadId);
	if (saved) return { photo: photoView(saved) };
	if (
		intent.status !== "pending" ||
		compareInstants(
			instantFromDate(intent.nextAttemptAt),
			systemClock.nowInstant(),
		) <= 0
	)
		throw new VehiclePhotoRefusal("upload_expired");
	if (vehicle.archivedAt) throw new VehiclePhotoRefusal("vehicle_archived");
	return { photo: null };
}
