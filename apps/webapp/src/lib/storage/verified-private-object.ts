import { createHash } from "node:crypto";
import { readPrivateObject } from "./export-s3-client";

/** A stored private object with the identity recorded when it was written. */
export interface RecordedPrivateObject {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
	/** Recorded size; null when it was never recorded (historical uploads). */
	sizeBytes: number | null;
	/** Recorded sha256 (hex); null when it was never recorded (historical uploads). */
	checksumSha256: string | null;
}

/**
 * Reads a private object and refuses it unless it still matches its recorded
 * size and sha256 (each checked when recorded). `label` names the object in
 * the error, e.g. "Stored document".
 */
export async function readVerifiedPrivateObject(
	object: RecordedPrivateObject,
	label: string,
): Promise<Uint8Array> {
	const bytes = await readPrivateObject({
		organizationId: object.organizationId,
		key: object.key,
		bucket: object.bucket,
		versionId: object.versionId,
	});
	if (
		(object.sizeBytes !== null && bytes.byteLength !== object.sizeBytes) ||
		(Boolean(object.checksumSha256) &&
			createHash("sha256").update(bytes).digest("hex") !== object.checksumSha256)
	) {
		throw new Error(`${label} content does not match its recorded identity`);
	}
	return bytes;
}
