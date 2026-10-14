import type { employeeDocument } from "@/db/schema";
import { readVerifiedPrivateObject } from "@/lib/storage/verified-private-object";
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
	return readVerifiedPrivateObject(
		{
			organizationId: document.organizationId,
			key: document.storageKey,
			bucket: document.storageBucket,
			versionId: document.storageVersionId,
			sizeBytes: document.sizeBytes,
			checksumSha256: document.checksumSha256,
		},
		"Stored document",
	);
}
