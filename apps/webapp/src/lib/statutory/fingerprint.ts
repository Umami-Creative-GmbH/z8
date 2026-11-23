import { createHash } from "node:crypto";

/**
 * Deterministic fingerprint of the inputs a statutory monitor evaluated (work periods, shifts,
 * offsets, wages, threshold values…). An acknowledgement stores the fingerprint it was given;
 * when a later evaluation produces a different fingerprint, the acknowledgement is stale.
 *
 * Canonical form: JSON with object keys sorted, arrays in the given order (sort them yourself
 * when order carries no meaning), Temporal values as their `toString()`. `undefined`, non-finite
 * numbers, functions, native `Date` and other non-plain objects (`Set`, `Map`…) are refused so a
 * fingerprint never silently drops data.
 */
export function statutoryInputFingerprint(input: unknown): string {
	const canonical = canonicalJson(input, "$");
	return `v1:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown, path: string): string {
	if (value === null) return "null";
	switch (typeof value) {
		case "string":
			return JSON.stringify(value);
		case "boolean":
			return value ? "true" : "false";
		case "number":
			if (!Number.isFinite(value)) throw new TypeError(`${path} is not a finite number`);
			return JSON.stringify(value);
		case "object":
			break;
		default:
			throw new TypeError(`${path} has no stable fingerprint form (${typeof value})`);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`)).join(",")}]`;
	}
	if (value instanceof Date) {
		throw new TypeError(`${path} is a Date; pass a Temporal value or an ISO string`);
	}
	const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
	if (typeof tag === "string" && tag.startsWith("Temporal.")) {
		return JSON.stringify(String(value));
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		// Set, Map, RegExp, class instances…: Object.entries() would silently drop their contents.
		throw new TypeError(`${path} is not a plain object, array or Temporal value`);
	}
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	);
	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, `${path}.${key}`)}`)
		.join(",")}}`;
}
