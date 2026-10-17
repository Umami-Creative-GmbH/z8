"use server";
import { Effect } from "effect";
import { z } from "zod";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { vehiclePhotosActor } from "@/lib/organization/vehicles/vehicle-photo-actor";
import { reconcilePhotoUpload } from "@/lib/organization/vehicles/vehicle-photo-reconciliation";
import {
	initiatePhotoBatchUpload,
	initiatePhotoUpload,
	listPhotos,
	removePhoto,
} from "@/lib/organization/vehicles/vehicle-photos";
export async function listVehiclePhotos(vehicleId: string) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* vehiclePhotosActor("read");
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.list", () =>
				listPhotos(service.db, actor, vehicleId),
			);
		}),
	);
}
export async function initiateVehiclePhotoUpload(vehicleId: string) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* vehiclePhotosActor("upload");
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.initiate", () =>
				initiatePhotoUpload(service.db, actor, vehicleId),
			);
		}),
	);
}

export async function removeVehiclePhoto(vehicleId: string, photoId: string) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* vehiclePhotosActor("remove");
			const input = z
				.object({ vehicleId: z.uuid(), photoId: z.uuid() })
				.safeParse({ vehicleId, photoId });
			if (!input.success)
				return yield* Effect.fail(
					new ValidationError({
						message: "Choose a valid vehicle photo",
						field: "photoId",
					}),
				);
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.remove", () =>
				removePhoto(
					service.db,
					actor,
					input.data.vehicleId,
					input.data.photoId,
				),
			);
		}),
	);
}

export async function reconcileVehiclePhotoUpload(
	vehicleId: string,
	uploadId: string,
) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* vehiclePhotosActor("upload");
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.reconcile", () =>
				reconcilePhotoUpload(service.db, actor, vehicleId, uploadId),
			);
		}),
	);
}

export async function initiateVehiclePhotoBatchUpload(
	vehicleId: string,
	uploadIds: string[],
) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* vehiclePhotosActor("upload");
			const input = z
				.object({
					vehicleId: z.uuid(),
					uploadIds: z
						.array(z.uuid())
						.min(1)
						.max(20)
						.refine((ids) => new Set(ids).size === ids.length),
				})
				.safeParse({ vehicleId, uploadIds });
			if (!input.success)
				return yield* Effect.fail(
					new ValidationError({
						message:
							"Choose between 1 and 20 photos with unique upload identities",
						field: "uploadIds",
					}),
				);
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.initiateBatch", () =>
				initiatePhotoBatchUpload(
					service.db,
					actor,
					input.data.vehicleId,
					input.data.uploadIds,
				),
			);
		}),
	);
}
