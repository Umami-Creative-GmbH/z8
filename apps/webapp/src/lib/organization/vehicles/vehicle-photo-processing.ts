import "server-only";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { MAX_VEHICLE_PHOTO_BYTES } from "./vehicle-photo-types";
export class VehiclePhotoInputError extends Error {
	constructor(
		message: string,
		readonly status = 400,
		readonly reason = "invalid_image",
	) {
		super(message);
	}
}
/** Stop reading as soon as the actual request crosses the inclusive size limit. */
export async function readPhotoBody(request: Request): Promise<Buffer> {
	const declared = Number(request.headers.get("content-length"));
	if (declared > MAX_VEHICLE_PHOTO_BYTES)
		throw new VehiclePhotoInputError(
			"Photo exceeds the 10 MB limit",
			413,
			"photo_too_large",
		);
	const reader = request.body?.getReader();
	if (!reader) throw new VehiclePhotoInputError("Choose a photo");
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			length += chunk.value.byteLength;
			if (length > MAX_VEHICLE_PHOTO_BYTES) {
				await reader.cancel();
				throw new VehiclePhotoInputError(
					"Photo exceeds the 10 MB limit",
					413,
					"photo_too_large",
				);
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, length);
}
export async function processVehiclePhoto(
	bytes: Buffer,
	declaredType: string | null,
) {
	if (bytes.byteLength > MAX_VEHICLE_PHOTO_BYTES)
		throw new VehiclePhotoInputError("Photo exceeds the 10 MB limit", 413);
	let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
	try {
		detected = await fileTypeFromBuffer(bytes);
	} catch {
		throw new VehiclePhotoInputError(
			"The photo could not be decoded. Choose JPEG, PNG or WebP.",
		);
	}
	if (
		declaredType?.includes("heic") ||
		declaredType?.includes("heif") ||
		detected?.mime.includes("hei")
	)
		throw new VehiclePhotoInputError(
			"HEIC photos are not supported. Choose JPEG, PNG or WebP.",
			400,
			"heic_unsupported",
		);
	const allowed = ["image/jpeg", "image/png", "image/webp"];
	if (
		!detected ||
		!allowed.includes(detected.mime) ||
		(declaredType && declaredType !== detected.mime)
	)
		throw new VehiclePhotoInputError(
			"Choose a JPEG, PNG or WebP photo with matching image contents",
			400,
			"unsupported_image",
		);
	try {
		const decoder = sharp(bytes, {
			limitInputPixels: 100_000_000,
			failOn: "warning",
		});
		const metadata = await decoder.metadata();
		if ((metadata.pages ?? 1) > 1)
			throw new VehiclePhotoInputError(
				"Animated photos are not supported",
				400,
				"animated_image",
			);
		const output = await decoder
			.autoOrient()
			.resize({
				width: 2560,
				height: 2560,
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({ quality: 82 })
			.toBuffer({ resolveWithObject: true });
		return {
			bytes: new Uint8Array(output.data),
			width: output.info.width,
			height: output.info.height,
		};
	} catch (error) {
		if (error instanceof VehiclePhotoInputError) throw error;
		throw new VehiclePhotoInputError(
			"The photo could not be decoded. Choose another JPEG, PNG or WebP.",
		);
	}
}
