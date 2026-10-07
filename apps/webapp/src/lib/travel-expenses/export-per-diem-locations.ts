import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "@/lib/approvals/evidence/travel-expense-report-facts";
import { PER_DIEM_LOCATION_FACTS_SCHEMA_VERSION } from "@/lib/approvals/evidence/travel-expense-report-per-diem";
import { encodePerDiemLocation, isOfficialFallbackRule } from "./per-diem-location";

/**
 * Export columns of a per diem's daily locations (#611, v10+): the foreign
 * table edition that priced days abroad and, per calendar day (its logical
 * date, never shifted through a zone), the entered location, the rate area
 * and official entry applied, the destination rule and the fact that decided
 * it. Days priced by an official fallback (Luxembourg, mother country,
 * Austria in flight, Luxembourg at sea) are counted separately.
 */

export const PER_DIEM_LOCATION_COLUMNS = [
	"per_diem_foreign_table_key",
	"per_diem_foreign_table_reference",
	"per_diem_foreign_table_version",
	"per_diem_day_locations",
	"per_diem_fallback_days",
] as const;

type Cells = {
	text: (value: string | null | undefined) => string;
	integer: (value: number) => string;
};

export function perDiemLocationCells(item: TravelExpenseReportSubmittedItem, cells: Cells) {
	const perDiem = item.perDiem;
	const located = perDiem?.days.filter((day) => day.location) ?? [];
	if (!perDiem || (located.length === 0 && !perDiem.rules.foreignTable)) {
		return PER_DIEM_LOCATION_COLUMNS.map(() => "");
	}
	const { foreignTable } = perDiem.rules;
	return [
		cells.text(foreignTable?.key),
		cells.text(foreignTable?.reference),
		cells.text(foreignTable?.version),
		cells.text(
			located
				.map((day) => {
					const location = day.location;
					if (!location) return "";
					const entered = encodePerDiemLocation(location.entered);
					const area = entered === location.area ? location.area : `${entered}>${location.area}`;
					return `${day.date} ${area} [${location.label}] ${location.rule} ${location.basis}`;
				})
				.join("; "),
		),
		cells.integer(
			located.filter((day) => day.location && isOfficialFallbackRule(day.location.rule)).length,
		),
	];
}

/** Daily locations frozen below the version that admits them are refused. */
export function perDiemLocationManifestProblem(
	facts: TravelExpenseReportSubmittedFacts,
): string | null {
	if (
		facts.schemaVersion < PER_DIEM_LOCATION_FACTS_SCHEMA_VERSION &&
		facts.items.some(
			(item) =>
				item.perDiem?.rules.foreignTable ||
				item.perDiem?.days.some((day) => day.location) ||
				item.perDiem?.meals.some((day) => day.night || day.activityAbroad),
		)
	) {
		return `Per diem daily locations in facts schema version ${facts.schemaVersion}`;
	}
	return null;
}
