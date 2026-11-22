import { Temporal } from "temporal-polyfill";
import {
	compareInstants,
	type Instant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { parseTimeZone } from "@/lib/timezone/validation";

export function serializePayrollLogicalDate(value: PlainDate) {
	return value.toString();
}

export function parsePayrollLogicalDate(value: string): PlainDate {
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		try {
			return parsePlainDate(trimmed);
		} catch {
			throw new Error("Invalid payroll logical date");
		}
	}
	try {
		return Temporal.PlainDate.from(trimmed);
	} catch {
		throw new Error("Invalid payroll logical date");
	}
}

export function buildEmployeePayrollRange(
	startDate: string,
	endDate: string,
	timezone: string,
): { start: Instant; end: Instant } {
	const tz = parseTimeZone(timezone);
	const start = parsePayrollLogicalDate(startDate).toZonedDateTime(tz).toInstant();
	const end = parsePayrollLogicalDate(endDate)
		.add({ days: 1 })
		.toZonedDateTime(tz)
		.toInstant()
		.subtract({ milliseconds: 1 });
	return { start, end };
}

export function buildPayrollQueryEnvelope(
	startDate: string,
	endDate: string,
): { start: Instant; end: Instant } {
	const start = parsePayrollLogicalDate(startDate)
		.toZonedDateTime("UTC")
		.toInstant()
		.subtract({ hours: 14 });
	const end = parsePayrollLogicalDate(endDate)
		.add({ days: 1 })
		.toZonedDateTime("UTC")
		.toInstant()
		.subtract({ milliseconds: 1 })
		.add({ hours: 14 });
	return { start, end };
}

export function clipPayrollInterval(
	start: Instant,
	end: Instant,
	range: { start: Instant; end: Instant },
): { start: Instant; end: Instant; durationMinutes: number } | null {
	const clippedStart = compareInstants(start, range.start) >= 0 ? start : range.start;
	const clippedEnd = compareInstants(end, range.end) <= 0 ? end : range.end;
	const durationMs = clippedEnd.epochMilliseconds - clippedStart.epochMilliseconds;
	const durationMinutes = Math.max(0, Math.round(durationMs / 60_000));
	return durationMinutes > 0 ? { start: clippedStart, end: clippedEnd, durationMinutes } : null;
}
