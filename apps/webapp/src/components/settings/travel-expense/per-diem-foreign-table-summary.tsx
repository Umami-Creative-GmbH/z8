"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { formatPlainDate } from "@/components/travel-expenses/report/format";
import {
	findForeignPerDiemTable,
	foreignTableRates,
} from "@/lib/travel-expenses/statutory-foreign-per-diem";
import type { StatutoryPerDiemDefault } from "@/lib/travel-expenses/statutory-per-diem-defaults";
import { foreignAreaCounts } from "./per-diem-foreign-areas";

/**
 * What adopting a statutory default with a verified foreign table adds
 * (#611): the official table, how many countries and places it lists, and
 * the travel days its amounts apply to.
 */
export function ForeignTableSummary({ entry }: { entry: StatutoryPerDiemDefault }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const table = entry.foreignTableKey ? findForeignPerDiemTable(entry.foreignTableKey) : null;
	if (!table) return null;
	const { countries, places } = foreignAreaCounts(foreignTableRates(table));
	return (
		<p className="text-sm text-muted-foreground">
			{t(
				"settings.travelExpenses.perDiem.foreignTable",
				"Includes the official foreign rates ({version}) for {countries} countries and {places} cities, applied to travel days from {from} to {through}. Unlisted countries and territories follow the official fallback rules; anything else is flagged for a manual calculation.",
				{
					version: table.version,
					countries,
					places,
					from: formatPlainDate(locale, table.validFrom),
					through: formatPlainDate(locale, table.validThrough),
				},
			)}
		</p>
	);
}
