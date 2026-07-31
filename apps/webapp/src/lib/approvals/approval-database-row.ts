import { parsePostgresTimestampWithoutTimeZoneAsUtc } from "@/db/postgres-utc";
import { parseInstant } from "@/lib/datetime/temporal-core";

const DATABASE_ROW_ERROR = "Approval database row is invalid";
const TIMESTAMP_WITHOUT_TIME_ZONE =
	/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;
const TIMESTAMPTZ =
	/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)$/;

function finiteDate(value: unknown): Date | null {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value;
	return null;
}

export function decodeApprovalDatabaseTimestampWithoutTimeZone(
	value: unknown,
): Date {
	const date = finiteDate(value);
	if (date) return date;
	if (typeof value !== "string" || !TIMESTAMP_WITHOUT_TIME_ZONE.test(value)) {
		throw new Error(DATABASE_ROW_ERROR);
	}
	try {
		const parsed = parsePostgresTimestampWithoutTimeZoneAsUtc(
			value.replace("T", " "),
		);
		if (!(parsed instanceof Date)) throw new Error(DATABASE_ROW_ERROR);
		return parsed;
	} catch {
		throw new Error(DATABASE_ROW_ERROR);
	}
}

export function decodeApprovalDatabaseTimestamptz(value: unknown): Date {
	const date = finiteDate(value);
	if (date) return date;
	if (typeof value !== "string" || !TIMESTAMPTZ.test(value)) {
		throw new Error(DATABASE_ROW_ERROR);
	}
	try {
		const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
		const result = new Date(parseInstant(normalized).epochMilliseconds);
		if (!Number.isFinite(result.getTime()))
			throw new RangeError("Invalid Date");
		return result;
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
