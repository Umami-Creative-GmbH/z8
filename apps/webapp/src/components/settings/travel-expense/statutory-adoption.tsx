"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { formatPlainDate, formatRecordedInstant } from "@/components/travel-expenses/report/format";
import type { PolicyVersion } from "./catalog-adoption";

/** Replaces a catalog's adopt button once the catalog is adopted. */
export function CatalogAdoptedNote({ version }: { version: PolicyVersion }) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<p className="text-sm font-medium">
			{t(
				"travelExpenses.settings.catalogAdopted",
				"Adopted on {date}, valid from {effectiveFrom}",
				{
					date: formatRecordedInstant(locale, version.createdAt),
					effectiveFrom: formatPlainDate(locale, version.effectiveFrom),
				},
			)}
		</p>
	);
}
