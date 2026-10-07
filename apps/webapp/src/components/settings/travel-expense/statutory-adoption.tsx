"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { formatPlainDate, formatRecordedInstant } from "@/components/travel-expenses/report/format";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";

interface PolicyVersion {
	source: AllowancePolicySource;
	effectiveFrom: string;
	createdAt: string;
	withdrawnAt: string | null;
}

/**
 * The active version that adopted the statutory catalog `defaultKey` (#689),
 * the latest-starting one if several did. A withdrawn version adopts nothing.
 */
export function catalogAdoption<T extends PolicyVersion>(
	versions: readonly T[],
	defaultKey: string,
): T | null {
	let latest: T | null = null;
	for (const version of versions) {
		if (version.withdrawnAt) continue;
		if (version.source.kind !== "statutory_default" || version.source.defaultKey !== defaultKey) {
			continue;
		}
		if (
			!latest ||
			comparePlainDates(
				parsePlainDate(version.effectiveFrom),
				parsePlainDate(latest.effectiveFrom),
			) > 0
		) {
			latest = version;
		}
	}
	return latest;
}

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
