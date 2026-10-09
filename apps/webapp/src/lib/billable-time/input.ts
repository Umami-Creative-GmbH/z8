/**
 * Reading untrusted Billable Time input (ids and calendar days from forms and
 * server action arguments), and recognizing database refusals. Client-safe.
 */

import { Temporal } from "temporal-polyfill";
import type { PlainDate } from "@/lib/datetime/temporal-core";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an untrusted value is a uuid (any case). */
export function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

/** An untrusted ISO calendar day ("2026-03-31"), or null for anything else. */
export function parsePlainDay(value: unknown): PlainDate | null {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	try {
		return Temporal.PlainDate.from(value, { overflow: "reject" });
	} catch {
		return null;
	}
}

/** Whether a database error (or one it wraps) is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
	let candidate: unknown = error;
	for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
		const current = candidate as { code?: unknown; cause?: unknown };
		if (current.code === "23505") return true;
		candidate = current.cause;
	}
	return false;
}
