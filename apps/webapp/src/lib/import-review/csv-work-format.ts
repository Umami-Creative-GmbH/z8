import Papa from "papaparse";
import { Temporal } from "temporal-polyfill";
import {
	buildWorkVehicleUse,
	type WorkVehicleUse,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import { parseIanaTimeZone } from "@/lib/timezone/validation";

export type CsvWorkVehicleUse = Omit<WorkVehicleUse, "vehicle"> & {
	vehicle: { kind: "own" } | { kind: "organization"; licencePlate: string };
};

function vehicleUse(source: Record<string, string>): CsvWorkVehicleUse | null {
	const kind = source.vehicle_kind?.trim() ?? "";
	const plate = source.licence_plate?.trim() ?? "";
	const number = (name: string) => {
		const value = source[name]?.trim() ?? "";
		if (!value) return null;
		if (!/^\d+$/.test(value))
			throw new Error(`${name} must contain whole kilometres`);
		return Number(value);
	};
	const startKm = number("odometer_start_km");
	const endKm = number("odometer_end_km");
	const distanceKm = number("distance_km");
	if (
		!kind &&
		!plate &&
		startKm === null &&
		endKm === null &&
		distanceKm === null
	)
		return null;
	if (
		(kind !== "own" && kind !== "organization") ||
		(kind === "own" ? !!plate : !plate)
	) {
		throw new Error(
			"Choose own vehicle without a plate, or organization vehicle with a plate",
		);
	}
	// Shared kilometre validation does not depend on a database vehicle id.
	const built = buildWorkVehicleUse({
		vehicle: { kind: "own" },
		startKm,
		endKm,
		distanceKm,
	});
	if (!built.ok) {
		const messages = {
			end_before_start: "The end reading cannot be below the start reading",
			invalid_reading:
				"Odometer readings must be non-negative whole kilometres within the supported limit",
			invalid_distance:
				"Distance must be non-negative whole kilometres within the supported limit",
			invalid_vehicle: "Choose an organization vehicle or an own vehicle",
		};
		throw new Error(messages[built.code]);
	}
	if (
		distanceKm !== null &&
		startKm !== null &&
		(endKm === null || distanceKm !== endKm - startKm)
	) {
		throw new Error(
			"The supplied distance conflicts with the odometer readings",
		);
	}
	return {
		...built.use,
		vehicle:
			kind === "own"
				? { kind: "own" }
				: { kind: "organization", licencePlate: plate },
	};
}

export interface CsvWorkEndpoint {
	at: string;
	capture: {
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: "csv_import";
	};
}
export interface CsvWorkRecord {
	personnelNumber: string;
	start: CsvWorkEndpoint;
	end: CsvWorkEndpoint;
	vehicle: CsvWorkVehicleUse | null;
}
export interface CsvWorkUploadRow {
	rowNumber: number;
	source: Record<string, string>;
	normalized: CsvWorkRecord | null;
	error: string | null;
}

function endpoint(value: string, selectedTimezone?: string): CsvWorkEndpoint {
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
			value,
		)
	)
		throw new Error("Use ISO date-times with at most millisecond precision");
	const offset = /(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[0];
	if (!offset) {
		if (!selectedTimezone)
			throw new Error("Select an IANA timezone for local timestamps");
		const zoned = Temporal.PlainDateTime.from(value).toZonedDateTime(
			selectedTimezone,
			{ disambiguation: "reject" },
		);
		return {
			at: zoned.toInstant().toString(),
			capture: {
				utcOffsetMinutes: zoned.offsetNanoseconds / 60_000_000_000,
				timezone: zoned.timeZoneId,
				timezoneSource: "csv_import",
			},
		};
	}
	const instant = Temporal.Instant.from(value);
	const timezone = offset === "Z" ? "UTC" : offset;
	return {
		at: instant.toString(),
		capture: {
			utcOffsetMinutes:
				instant.toZonedDateTimeISO(timezone).offsetNanoseconds / 60_000_000_000,
			timezone,
			timezoneSource: "csv_import",
		},
	};
}

export const CSV_WORK_COLUMNS = [
	"personnel_number",
	"starts_at",
	"ends_at",
	"vehicle_kind",
	"licence_plate",
	"odometer_start_km",
	"odometer_end_km",
	"distance_km",
] as const;
export const CSV_WORK_MAX_BYTES = 500_000;
export const CSV_WORK_MAX_ROWS = 1_000;

/** The normalized public row contract, also used to revalidate retained source at commit. */
export function parseCsvWorkRecord(
	source: Record<string, string>,
	timezone?: string | null,
): CsvWorkRecord {
	const personnelNumber = source.personnel_number?.trim() ?? "";
	if (!personnelNumber || personnelNumber.length > 128)
		throw new Error("A personnel number of at most 128 characters is required");
	const start = endpoint(source.starts_at?.trim() ?? "", timezone ?? undefined);
	const end = endpoint(source.ends_at?.trim() ?? "", timezone ?? undefined);
	if (Temporal.Instant.compare(start.at, end.at) >= 0)
		throw new Error(
			"The end must be after the start, with an explicit end date",
		);
	return { personnelNumber, start, end, vehicle: vehicleUse(source) };
}

/** Fixed UTF-8 comma-separated template; blank optional columns may be omitted. */
export function parseCsvWorkUpload(text: string, selectedTimezone?: string) {
	if (
		typeof text !== "string" ||
		new TextEncoder().encode(text).length > CSV_WORK_MAX_BYTES
	)
		throw new Error("CSV files must be at most 500 KB");
	const timezone = selectedTimezone?.trim()
		? parseIanaTimeZone(selectedTimezone.trim())
		: null;
	const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
		delimiter: ",",
		skipEmptyLines: "greedy",
	});
	if (parsed.errors.length)
		throw new Error("Malformed CSV: check quotes and comma separators");
	const [rawHeaders = [], ...records] = parsed.data;
	const headers = rawHeaders.map((value) => value.trim());
	const headerSet = new Set(headers);
	if (
		headerSet.size !== headers.length ||
		headers.some(
			(value) => !CSV_WORK_COLUMNS.some((column) => column === value),
		)
	)
		throw new Error(
			"CSV headers must be unique and use the Z8 template columns",
		);
	if (CSV_WORK_COLUMNS.slice(0, 3).some((key) => !headerSet.has(key)))
		throw new Error(
			"Required CSV columns: personnel_number, starts_at, ends_at",
		);
	if (!records.length || records.length > CSV_WORK_MAX_ROWS)
		throw new Error("Upload between 1 and 1000 completed work rows");
	if (records.some((record) => record.length !== headers.length))
		throw new Error(
			"Every CSV row must have the same number of columns as the header",
		);
	const rows = records.map((record, index): CsvWorkUploadRow => {
		const source = Object.fromEntries(
			headers.map((key, column) => [key, record[column] ?? ""]),
		);
		try {
			return {
				rowNumber: index + 2,
				source,
				normalized: parseCsvWorkRecord(source, timezone),
				error: null,
			};
		} catch (error) {
			return {
				rowNumber: index + 2,
				source,
				normalized: null,
				error: error instanceof Error ? error.message : "Invalid row",
			};
		}
	});
	return { timezone, rows };
}

export function csvWorkTemplate(): string {
	return (
		Papa.unparse(
			{
				fields: [...CSV_WORK_COLUMNS],
				data: [
					[
						"0042",
						"2026-07-22T08:00:00+02:00",
						"2026-07-22T12:00:00+02:00",
						"organization",
						"M-AB 1234",
						"10000",
						"10045",
						"",
					],
					[
						"0042",
						"2026-07-22T12:30:00+02:00",
						"2026-07-22T16:00:00+02:00",
						"own",
						"",
						"",
						"",
						"30",
					],
				],
			},
			{ newline: "\r\n" },
		) + "\r\n"
	);
}
