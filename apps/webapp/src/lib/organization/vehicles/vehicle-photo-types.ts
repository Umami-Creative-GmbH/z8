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
export type VehiclePhotoRefusal = "vehicle_not_found" | "vehicle_archived" | "photo_limit" | "upload_not_found" | "upload_expired" | "forbidden";
