import { parsePostgresTimestampWithoutTimeZoneAsUtc } from "@/db/postgres-utc";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";

const DATABASE_ROW_ERROR = "Approval database row is invalid";

export function decodeApprovalDatabaseTimestamp(value: unknown): Date {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value;
	if (typeof value !== "string") throw new Error(DATABASE_ROW_ERROR);
	const parsed = parsePostgresTimestampWithoutTimeZoneAsUtc(value);
	if (!(parsed instanceof Date)) throw new Error(DATABASE_ROW_ERROR);
	return parsed;
}

export function decodeApprovalDatabaseInstant(value: unknown): Date {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value;
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(
			value,
		)
	) {
		throw new Error(DATABASE_ROW_ERROR);
	}
	try {
		const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
		return dateFromInstant(parseInstant(normalized));
	} catch {
		throw new Error(DATABASE_ROW_ERROR);
	}
}

export function decodeApprovalDatabaseJsonText(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(DATABASE_ROW_ERROR);
	}
}
