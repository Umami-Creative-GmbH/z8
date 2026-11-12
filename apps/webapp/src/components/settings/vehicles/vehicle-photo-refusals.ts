import type { VehiclePhotoRefusalCode } from "@/lib/organization/vehicles/vehicle-photo-types";
import type {
	ActionMessage,
	RefusalMessages,
	RefusalOverrides,
} from "@/lib/organization-action/action-error-message";

/**
 * Why the upload route refused a photo body (`reason` of its JSON failure),
 * or why the browser refused it before sending.
 */
export type VehiclePhotoInputRefusal =
	| "heic_unsupported"
	| "unsupported_image"
	| "animated_image"
	| "invalid_image"
	| "photo_too_large";

const FINAL_UPLOAD_REFUSALS: ReadonlySet<string> = new Set<
	VehiclePhotoInputRefusal | VehiclePhotoRefusalCode
>([
	"invalid_image",
	"unsupported_image",
	"heic_unsupported",
	"animated_image",
	"photo_too_large",
	"upload_expired",
	"upload_not_found",
]);

/** Whether retrying can help: not for a refusal the person fixes by choosing the photo again. */
export function isRetryableUploadRefusal(refusal: string | null | undefined): boolean {
	return refusal == null || !FINAL_UPLOAD_REFUSALS.has(refusal);
}

const unsupported: ActionMessage = [
	"settings.vehicles.photos.unsupported",
	"Choose a JPEG, PNG or WebP photo. HEIC and other formats are not supported.",
];
const archived: ActionMessage = [
	"settings.vehicles.photos.archived",
	"This vehicle is archived. Restore it to add or remove photos.",
];
const accessChanged: ActionMessage = [
	"settings.vehicles.photos.accessChanged",
	"Your access changed. Reopen vehicle settings to check your permissions.",
];
const expired: ActionMessage = [
	"settings.vehicles.photos.expired",
	"This upload expired. Select the photo again to upload it.",
];
export const UPLOAD_FAILED: ActionMessage = [
	"settings.vehicles.photos.uploadFailed",
	"The photo could not be uploaded. Try again.",
];
export const REMOVE_FAILED: ActionMessage = [
	"settings.vehicles.photos.removeFailed",
	"The photo could not be removed. Try again.",
];
export const LOAD_FAILED: ActionMessage = [
	"settings.vehicles.photos.loadFailed",
	"The photos could not be loaded. Close the dialog and try again.",
];

/** The photo UI words a failure without a refusal of its own the same as any failure. */
function everyCode(message: ActionMessage): RefusalOverrides {
	return {
		AuthenticationError: message,
		AuthorizationError: message,
		ValidationError: message,
	};
}

/**
 * How the upload queue words a refused reservation, reconciliation or upload
 * (`actionErrorMessage`). Lost access and another user's upload identity
 * (`NotFoundError`) read as changed access.
 */
export const VEHICLE_PHOTO_UPLOAD_REFUSALS = {
	...everyCode(UPLOAD_FAILED),
	AuthenticationError: accessChanged,
	AuthorizationError: accessChanged,
	NotFoundError: accessChanged,
	heic_unsupported: unsupported,
	unsupported_image: unsupported,
	animated_image: unsupported,
	invalid_image: [
		"settings.vehicles.photos.invalid",
		"This image could not be read. Choose another JPEG, PNG or WebP photo.",
	],
	photo_too_large: ["settings.vehicles.photos.tooLarge", "Choose a photo no larger than 10 MB."],
	vehicle_archived: archived,
	photo_limit: (t, failure) => {
		const remaining = failure.details?.remaining;
		return typeof remaining === "number"
			? t(
					"settings.vehicles.photos.capacityChanged",
					"The gallery changed. {count} photo slots remain. Reopen it and choose fewer photos.",
					{ count: remaining },
				)
			: t(
					"settings.vehicles.photos.full",
					"This vehicle has 20 photos. Remove a photo before adding another.",
				);
	},
	vehicle_not_found: [
		"settings.vehicles.photos.vehicleMissing",
		"This vehicle is no longer available in your organization.",
	],
	upload_not_found: expired,
	upload_expired: expired,
	// Only a removal refuses with it; worded as today's generic upload failure.
	photo_not_found: UPLOAD_FAILED,
} satisfies RefusalOverrides & RefusalMessages<VehiclePhotoRefusalCode | VehiclePhotoInputRefusal>;

/** How the photo viewer words a refused removal: an archived vehicle, else a failure. */
export const VEHICLE_PHOTO_REMOVAL_REFUSALS = {
	...everyCode(REMOVE_FAILED),
	vehicle_archived: archived,
	vehicle_not_found: REMOVE_FAILED,
	photo_not_found: REMOVE_FAILED,
} satisfies RefusalOverrides &
	RefusalMessages<
		Extract<VehiclePhotoRefusalCode, "vehicle_archived" | "vehicle_not_found" | "photo_not_found">
	>;

/** How the gallery words a refused load (only `vehicle_not_found`): always as a load failure. */
export const VEHICLE_PHOTO_LOAD_REFUSALS = {
	...everyCode(LOAD_FAILED),
	vehicle_not_found: LOAD_FAILED,
} satisfies RefusalOverrides & RefusalMessages<"vehicle_not_found">;
