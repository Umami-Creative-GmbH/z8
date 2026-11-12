"use server";
import { Effect } from "effect";
import { z } from "zod";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { reconcilePhotoUpload } from "@/lib/organization/vehicles/vehicle-photo-reconciliation";
import {
	initiatePhotoBatchUpload,
	initiatePhotoUpload,
	listPhotos,
	removePhoto,
} from "@/lib/organization/vehicles/vehicle-photos";
import {
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";

/** The photo helpers' actor: the session's organization and the caller. */
const photoActor = (actor: OrganizationActor, organizationId: string) => ({
	organizationId,
	userId: actor.userId,
});

const vehicleSchema = z.strictObject({ vehicleId: z.string() });

export const listVehiclePhotos = organizationAction(
	{ name: "vehiclePhotos.list", requires: "orgAdmin", schema: vehicleSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.list", () =>
				listPhotos(service.db, photoActor(actor, organizationId), input.vehicleId),
			);
		}),
);

export const initiateVehiclePhotoUpload = organizationAction(
	{ name: "vehiclePhotos.initiate", requires: "orgAdmin", schema: vehicleSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.initiate", () =>
				initiatePhotoUpload(service.db, photoActor(actor, organizationId), input.vehicleId),
			);
		}),
);

export const removeVehiclePhoto = organizationAction(
	{
		name: "vehiclePhotos.remove",
		requires: "orgAdmin",
		schema: z.strictObject({
			vehicleId: z.uuid({ error: "Choose a valid vehicle photo" }),
			photoId: z.uuid({ error: "Choose a valid vehicle photo" }),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.remove", () =>
				removePhoto(service.db, photoActor(actor, organizationId), input.vehicleId, input.photoId),
			);
		}),
);

export const reconcileVehiclePhotoUpload = organizationAction(
	{
		name: "vehiclePhotos.reconcile",
		requires: "orgAdmin",
		schema: z.strictObject({ vehicleId: z.string(), uploadId: z.string() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.reconcile", () =>
				reconcilePhotoUpload(
					service.db,
					photoActor(actor, organizationId),
					input.vehicleId,
					input.uploadId,
				),
			);
		}),
);

const batchError = "Choose between 1 and 20 photos with unique upload identities";

export const initiateVehiclePhotoBatchUpload = organizationAction(
	{
		name: "vehiclePhotos.initiateBatch",
		requires: "orgAdmin",
		schema: z.strictObject({
			vehicleId: z.uuid({ error: batchError }),
			uploadIds: z
				.array(z.uuid({ error: batchError }), { error: batchError })
				.min(1, { error: batchError })
				.max(20, { error: batchError })
				.refine((ids) => new Set(ids).size === ids.length, { error: batchError }),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* service.query("vehiclePhotos.initiateBatch", () =>
				initiatePhotoBatchUpload(
					service.db,
					photoActor(actor, organizationId),
					input.vehicleId,
					input.uploadIds,
				),
			);
		}),
);
