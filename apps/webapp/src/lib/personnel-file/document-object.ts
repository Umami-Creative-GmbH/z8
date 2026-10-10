import { createHash } from "node:crypto";
import type { employeeDocument } from "@/db/schema";
import { readPrivateObject } from "@/lib/storage/export-s3-client";
import { PERSONNEL_DOCUMENT_STORAGE_PROVIDER } from "./document-store";

type StoredDocument = Pick<
	typeof employeeDocument.$inferSelect,
	| "organizationId"
	| "storageProvider"
	| "storageKey"
	| "storageBucket"
	| "storageVersionId"
	| "sizeBytes"
	| "checksumSha256"
>;

/**
 * Reads an employee document's stored object and refuses it unless its size
 * and sha256 still match the identity recorded on the document (#865, #871).
 * Every path that hands document content out goes through this check.
 */
export async function readVerifiedDocumentObject(document: StoredDocument): Promise<Uint8Array> {
	if (document.storageProvider !== PERSONNEL_DOCUMENT_STORAGE_PROVIDER) {
		throw new Error("Unsupported recorded document storage provider");
	}
	const bytes = await readPrivateObject({
		organizationId: document.organizationId,
		key: document.storageKey,
		bucket: document.storageBucket,
		versionId: document.storageVersionId,
	});
	if (
		bytes.byteLength !== document.sizeBytes ||
		createHash("sha256").update(bytes).digest("hex") !== document.checksumSha256
	) {
		throw new Error("Stored document content does not match its recorded identity");
	}
	return bytes;
}
