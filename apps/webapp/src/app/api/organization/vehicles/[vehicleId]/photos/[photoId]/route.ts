import { db } from "@/db";
import { runServerActionSafe } from "@/lib/effect/result";
import { vehiclePhotosActor } from "@/lib/organization/vehicles/vehicle-photo-actor";
import {
	processVehiclePhoto,
	readPhotoBody,
	VehiclePhotoInputError,
} from "@/lib/organization/vehicles/vehicle-photo-processing";
import {
	finalizePhotoUpload,
	findPhoto,
	notePhotoUploadFailure,
	ownedPhotoUpload,
	photoView,
	pinPhotoStorage,
	rejectPhotoUpload,
} from "@/lib/organization/vehicles/vehicle-photos";
import {
	getStorageConfig,
	readPrivateObject,
	uploadPrivateObject,
} from "@/lib/storage/export-s3-client";
export const runtime = "nodejs";
const privateHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
	Vary: "Cookie",
};
type Context = { params: Promise<{ vehicleId: string; photoId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(error: string, status: number, reason = error) {
	return Response.json(
		{ ok: false, error, reason },
		{ status, headers: privateHeaders },
	);
}
export async function GET(_request: Request, context: Context) {
	const actor = await runServerActionSafe(vehiclePhotosActor("read"));
	if (!actor.success)
		return failure(
			"Photo access denied",
			actor.code === "AuthenticationError" ? 401 : 403,
		);
	const { vehicleId, photoId } = await context.params;
	if (!uuid.test(vehicleId) || !uuid.test(photoId))
		return failure("Photo not found", 404);
	const row = await findPhoto(db, actor.data, vehicleId, photoId);
	if (!row) return failure("Photo not found", 404);
	try {
		const bytes = await readPrivateObject({
			organizationId: actor.data.organizationId,
			key: row.storageKey,
			bucket: row.storageBucket,
			versionId: row.storageVersionId,
		});
		return new Response(new Uint8Array(bytes), {
			headers: {
				...privateHeaders,
				"Content-Type": "image/webp",
				"Content-Disposition": 'inline; filename="vehicle-photo.webp"',
			},
		});
	} catch {
		return failure("Photo is temporarily unavailable", 503);
	}
}
export async function POST(request: Request, context: Context) {
	if (request.headers.get("origin") !== new URL(request.url).origin)
		return failure("Upload origin denied", 403);
	const actor = await runServerActionSafe(vehiclePhotosActor("upload"));
	if (!actor.success)
		return failure(
			"Photo access denied",
			actor.code === "AuthenticationError" ? 401 : 403,
		);
	const { vehicleId, photoId } = await context.params;
	if (!uuid.test(vehicleId) || !uuid.test(photoId))
		return failure("Upload not found", 404);
	const intent = await ownedPhotoUpload(db, actor.data, vehicleId, photoId);
	if (!intent) return failure("Upload not found", 404);
	try {
		const already = await findPhoto(db, actor.data, vehicleId, photoId);
		if (already)
			return Response.json(
				{ ok: true, photo: photoView(already) },
				{ headers: privateHeaders },
			);
		const image = await processVehiclePhoto(
			await readPhotoBody(request),
			request.headers.get("content-type")?.split(";")[0] ?? null,
		);
		const current = await runServerActionSafe(vehiclePhotosActor("upload"));
		if (
			!current.success ||
			current.data.organizationId !== actor.data.organizationId ||
			current.data.userId !== actor.data.userId
		) {
			await rejectPhotoUpload(
				db,
				actor.data,
				vehicleId,
				photoId,
				"authorization_changed",
			);
			return failure("Photo access denied", 403);
		}
		const config = await getStorageConfig(current.data.organizationId);
		if (!config) throw new Error("Private storage unavailable");
		if (
			!(await pinPhotoStorage(
				db,
				current.data,
				vehicleId,
				photoId,
				config.bucket,
			))
		) {
			const existing = await findPhoto(db, current.data, vehicleId, photoId);
			if (existing)
				return Response.json(
					{ ok: true, photo: photoView(existing) },
					{ headers: privateHeaders },
				);
			return failure("Upload expired", 409, "upload_expired");
		}
		const outcome = await finalizePhotoUpload(
			db,
			current.data,
			vehicleId,
			photoId,
			image,
			(key) =>
				uploadPrivateObject(
					current.data.organizationId,
					key,
					image.bytes,
					"image/webp",
					undefined,
					config.bucket,
				),
		);
		if (!outcome.ok)
			return failure(
				outcome.reason,
				outcome.reason === "forbidden" ? 403 : 409,
			);
		return Response.json(outcome, { headers: privateHeaders });
	} catch (error) {
		if (error instanceof VehiclePhotoInputError)
			await rejectPhotoUpload(
				db,
				actor.data,
				vehicleId,
				photoId,
				error.message,
			);
		else await notePhotoUploadFailure(db, actor.data, vehicleId, photoId);
		return failure(
			error instanceof VehiclePhotoInputError
				? error.message
				: "Photo upload failed. Please try again.",
			error instanceof VehiclePhotoInputError ? error.status : 503,
			error instanceof VehiclePhotoInputError ? error.reason : "upload_failed",
		);
	}
}
