export const MAX_VEHICLE_PHOTOS = 20;
export const MAX_VEHICLE_PHOTO_BYTES = 10 * 1024 * 1024;
export interface VehiclePhotoView {
	id: string;
	vehicleId: string;
	width: number;
	height: number;
	createdAt: string;
	order: number;
	imageUrl: string;
}
/**
 * Why a vehicle photo action was refused (#1652). The client words the code
 * through `actionErrorMessage`; missing access fails as `AuthorizationError`
 * and another user's or organization's upload identity as `NotFoundError`.
 */
export type VehiclePhotoRefusalCode =
	| "photo_not_found"
	| "vehicle_not_found"
	| "vehicle_archived"
	| "photo_limit"
	| "upload_not_found"
	| "upload_expired";

/** What a refusal carries beside its code: the slots left after a refused batch. */
export interface VehiclePhotoRefusalDetails {
	remaining?: number;
}

/**
 * A vehicle photo refusal the stores throw; `storeStep` turns it into a
 * `ValidationError` with `refusal: code` and `details`. Client-safe.
 */
export class VehiclePhotoRefusal extends Error {
	readonly code: VehiclePhotoRefusalCode;
	readonly details?: VehiclePhotoRefusalDetails;

	constructor(code: VehiclePhotoRefusalCode, details?: VehiclePhotoRefusalDetails) {
		super(`Vehicle photo refused: ${code}`);
		this.name = "VehiclePhotoRefusal";
		this.code = code;
		if (details) this.details = details;
	}
}
