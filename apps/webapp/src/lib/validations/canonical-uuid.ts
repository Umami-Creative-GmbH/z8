/**
 * A lowercase, hyphenated UUID as PostgreSQL returns it. Use it to recognize
 * persisted identifiers in stored JSON, task payloads and URL parameters that
 * must match an existing row exactly. Client-safe.
 */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID.test(value);
}
