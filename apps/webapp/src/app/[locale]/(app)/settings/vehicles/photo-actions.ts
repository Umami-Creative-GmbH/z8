"use server";
import { Effect } from "effect";
import { z } from "zod";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { vehiclePhotosActor } from "@/lib/organization/vehicles/vehicle-photo-actor";
import {
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
