/**
 * Storage identity never leaves the server (#811, #1169): object keys,
 * buckets, versions and checksums are secrets, also inside JSON values such as
 * frozen revisions and legacy snapshots, which embed receipt object
 * references (`{ provider, bucket, key, versionId }`). Collectors pass every
 * JSON value they export through here.
 */

import type { PersonalDataValue } from "./collector";

/** Field names that hold storage identity, in camel and snake case. */
const STORAGE_IDENTITY_FIELDS = new Set([
	"storageProvider",
	"storageBucket",
	"storageKey",
	"storageVersionId",
	"checksumSha256",
	"storage_provider",
	"storage_bucket",
	"storage_key",
	"storage_version_id",
	"checksum_sha256",
	"bucket",
	"versionId",
	"version_id",
]);

/** A stored-object reference: it names a bucket and a key. */
function isObjectReference(value: Record<string, unknown>): boolean {
	return "bucket" in value && "key" in value;
}

/** A deep copy of `value` without stored-object references and storage identity fields. */
export function withoutStorageReferences(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutStorageReferences);
	if (value === null || typeof value !== "object") return value;
	const cleaned: Record<string, unknown> = {};
	for (const [field, nested] of Object.entries(value)) {
		if (STORAGE_IDENTITY_FIELDS.has(field)) continue;
		if (
			nested !== null &&
			typeof nested === "object" &&
			!Array.isArray(nested) &&
			isObjectReference(nested as Record<string, unknown>)
		) {
			continue;
		}
		cleaned[field] = withoutStorageReferences(nested);
	}
	return cleaned;
}

/** A JSON column as an exportable JSON string, storage identity removed; null stays null. */
export function jsonWithoutStorageReferences(value: unknown): PersonalDataValue {
	if (value === null || value === undefined) return null;
	return JSON.stringify(withoutStorageReferences(value));
}
