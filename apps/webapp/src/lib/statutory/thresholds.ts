import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { statutoryThreshold } from "@/db/schema";
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryThresholdKey, StatutoryThresholdUnit } from "./threshold-catalog";

/** A platform-managed baseline row. `effectiveUntilDate` is exclusive; null means open-ended. */
export interface StatutoryThresholdRow {
	readonly key: StatutoryThresholdKey;
	readonly countryCode: string;
	readonly value: number;
	readonly unit: StatutoryThresholdUnit;
	readonly currency: string | null;
	readonly effectiveFromDate: string;
	readonly effectiveUntilDate: string | null;
	readonly legalReference: string | null;
	readonly notes: string | null;
}

/** A part of a requested range covered by one baseline value; `until` is exclusive. */
export interface StatutoryThresholdSegment {
	readonly from: string;
	readonly until: string;
	readonly value: number;
}

/**
 * Baselines for a set of keys, loaded once, answered in memory. Monitors load the keys and the
 * range they evaluate, then resolve each evaluated day, week or month without further queries.
 */
export interface StatutoryThresholdTable {
	/** All loaded rows of `key`, ordered by effective date. */
	rows(key: StatutoryThresholdKey): readonly StatutoryThresholdRow[];
	/** The row in force on `date` (YYYY-MM-DD), or null when no baseline covers it. */
	rowOn(key: StatutoryThresholdKey, date: string): StatutoryThresholdRow | null;
	/** The value in force on `date`, or null when no baseline covers it. */
	valueOn(key: StatutoryThresholdKey, date: string): number | null;
	/**
	 * The parts of `[from, until)` each covered by one baseline, clipped to the range. Days no
	 * baseline covers are left out, so a caller can detect gaps by comparing the boundaries.
	 */
	segments(key: StatutoryThresholdKey, from: string, until: string): StatutoryThresholdSegment[];
}

export type StatutoryThresholdReader = Pick<DatabaseClient, "select">;

function covers(row: StatutoryThresholdRow, date: PlainDate): boolean {
	return (
		comparePlainDates(parsePlainDate(row.effectiveFromDate), date) <= 0 &&
		(row.effectiveUntilDate === null ||
			comparePlainDates(date, parsePlainDate(row.effectiveUntilDate)) < 0)
	);
}

function laterDate(left: string, right: string): string {
	return comparePlainDates(parsePlainDate(left), parsePlainDate(right)) >= 0 ? left : right;
}

function earlierDate(left: string, right: string): string {
	return comparePlainDates(parsePlainDate(left), parsePlainDate(right)) <= 0 ? left : right;
}

/** Builds the in-memory table from rows; exported for pure unit tests of monitor math. */
export function buildStatutoryThresholdTable(
	loadedKeys: readonly StatutoryThresholdKey[],
	rows: readonly StatutoryThresholdRow[],
): StatutoryThresholdTable {
	const byKey = new Map<StatutoryThresholdKey, StatutoryThresholdRow[]>(
		loadedKeys.map((key) => [key, []]),
	);
	for (const row of rows) byKey.get(row.key)?.push(row);
	for (const list of byKey.values()) {
		list.sort((a, b) =>
			comparePlainDates(parsePlainDate(a.effectiveFromDate), parsePlainDate(b.effectiveFromDate)),
		);
	}

	function rowsOf(key: StatutoryThresholdKey): StatutoryThresholdRow[] {
		const list = byKey.get(key);
		if (!list) throw new Error(`Statutory threshold ${key} was not loaded`);
		return list;
	}

	function rowOn(key: StatutoryThresholdKey, date: string): StatutoryThresholdRow | null {
		const day = parsePlainDate(date);
		return rowsOf(key).find((row) => covers(row, day)) ?? null;
	}

	return {
		rows: rowsOf,
		rowOn,
		valueOn: (key, date) => rowOn(key, date)?.value ?? null,
		segments(key, from, until) {
			if (comparePlainDates(parsePlainDate(from), parsePlainDate(until)) >= 0) return [];
			const segments: StatutoryThresholdSegment[] = [];
			for (const row of rowsOf(key)) {
				const start = laterDate(row.effectiveFromDate, from);
				const end = row.effectiveUntilDate ? earlierDate(row.effectiveUntilDate, until) : until;
				if (comparePlainDates(parsePlainDate(start), parsePlainDate(end)) < 0) {
					segments.push({ from: start, until: end, value: row.value });
				}
			}
			return segments;
		},
	};
}

/**
 * Loads the platform baselines (`organization_id IS NULL`) of `keys` that overlap `[from, until)`.
 * Tenants never override statutory baselines; organization preferences only tune warning tiers.
 */
export async function loadStatutoryThresholds(
	db: StatutoryThresholdReader,
	input: {
		keys: readonly StatutoryThresholdKey[];
		from: string;
		until: string;
		countryCode?: string;
	},
): Promise<StatutoryThresholdTable> {
	parsePlainDate(input.from);
	parsePlainDate(input.until);
	if (input.keys.length === 0) return buildStatutoryThresholdTable([], []);

	const rows = await db
		.select({
			key: statutoryThreshold.thresholdKey,
			countryCode: statutoryThreshold.countryCode,
			integerValue: statutoryThreshold.integerValue,
			numericValue: statutoryThreshold.numericValue,
			unit: statutoryThreshold.unit,
			currency: statutoryThreshold.currency,
			effectiveFromDate: statutoryThreshold.effectiveFromDate,
			effectiveUntilDate: statutoryThreshold.effectiveUntilDate,
			legalReference: statutoryThreshold.legalReference,
			notes: statutoryThreshold.notes,
		})
		.from(statutoryThreshold)
		.where(
			and(
				isNull(statutoryThreshold.organizationId),
				eq(statutoryThreshold.countryCode, input.countryCode ?? "DE"),
				inArray(statutoryThreshold.thresholdKey, [...input.keys]),
				lt(statutoryThreshold.effectiveFromDate, input.until),
				or(
					isNull(statutoryThreshold.effectiveUntilDate),
					gt(statutoryThreshold.effectiveUntilDate, input.from),
				),
			),
		)
		.orderBy(asc(statutoryThreshold.thresholdKey), asc(statutoryThreshold.effectiveFromDate));

	return buildStatutoryThresholdTable(
		input.keys,
		rows.map((row) => ({
			key: row.key as StatutoryThresholdKey,
			countryCode: row.countryCode,
			value: row.integerValue ?? Number(row.numericValue),
			unit: (row.unit ?? "minutes") as StatutoryThresholdUnit,
			currency: row.currency,
			effectiveFromDate: row.effectiveFromDate,
			effectiveUntilDate: row.effectiveUntilDate,
			legalReference: row.legalReference,
			notes: row.notes,
		})),
	);
}

/** The baseline of `key` in force on `date` (YYYY-MM-DD), or null when none covers it. */
export async function resolveStatutoryThreshold(
	db: StatutoryThresholdReader,
	key: StatutoryThresholdKey,
	date: string,
	countryCode = "DE",
): Promise<StatutoryThresholdRow | null> {
	const until = parsePlainDate(date).add({ days: 1 }).toString();
	const table = await loadStatutoryThresholds(db, { keys: [key], from: date, until, countryCode });
	return table.rowOn(key, date);
}
