"use server";
import { z } from "zod";
import { reconcilePhotoUpload } from "@/lib/organization/vehicles/vehicle-photo-reconciliation";
import { VehiclePhotoRefusal } from "@/lib/organization/vehicles/vehicle-photo-types";
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
import { storeStep } from "@/lib/organization-action/store-step";

/** The photo helpers' actor: the session's organization and the caller. */
const photoActor = (actor: OrganizationActor, organizationId: string) => ({
	organizationId,
	userId: actor.userId,
});

/** A refused photo action fails with `refusal` set to its `VehiclePhotoRefusalCode`. */
const refusal = { refusal: VehiclePhotoRefusal };

const vehicleSchema = z.strictObject({ vehicleId: z.string() });

export const listVehiclePhotos = organizationAction(
	{ name: "vehiclePhotos.list", requires: "orgAdmin", schema: vehicleSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"vehiclePhotos.list",
			(db) => listPhotos(db, photoActor(actor, organizationId), input.vehicleId),
			refusal,
		),
);

export const initiateVehiclePhotoUpload = organizationAction(
	{ name: "vehiclePhotos.initiate", requires: "orgAdmin", schema: vehicleSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"vehiclePhotos.initiate",
			(db) => initiatePhotoUpload(db, photoActor(actor, organizationId), input.vehicleId),
			refusal,
		),
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
		storeStep(
			"vehiclePhotos.remove",
			(db) => removePhoto(db, photoActor(actor, organizationId), input.vehicleId, input.photoId),
			refusal,
		),
);

export const reconcileVehiclePhotoUpload = organizationAction(
	{
		name: "vehiclePhotos.reconcile",
		requires: "orgAdmin",
		schema: z.strictObject({ vehicleId: z.string(), uploadId: z.string() }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"vehiclePhotos.reconcile",
			(db) =>
				reconcilePhotoUpload(
					db,
					photoActor(actor, organizationId),
					input.vehicleId,
					input.uploadId,
				),
			refusal,
		),
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
		storeStep(
			"vehiclePhotos.initiateBatch",
			(db) =>
				initiatePhotoBatchUpload(
					db,
					photoActor(actor, organizationId),
					input.vehicleId,
					input.uploadIds,
				),
			refusal,
		),
);
