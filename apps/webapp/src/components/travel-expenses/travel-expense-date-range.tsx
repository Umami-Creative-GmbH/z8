"use client";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	comparePlainDates,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
export function TravelExpenseDateRange({
	startDate,
	endDate,
}: {
	startDate?: string | null;
	endDate?: string | null;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	let range: string | null = null;
	if (startDate && endDate) {
		try {
			const start = parsePlainDate(startDate);
			const end = parsePlainDate(endDate);
			if (comparePlainDates(start, end) <= 0) {
				const startLabel = start.toLocaleString(locale, {
					dateStyle: "medium",
				});
				range = start.equals(end)
					? startLabel
					: `${startLabel} – ${end.toLocaleString(locale, { dateStyle: "medium" })}`;
			}
		} catch {
			/* Legacy rows can lack reliable logical date context. */
		}
	}
	return (
		<span>
			{range ??
				t(
					"travelExpenses.detail.unknownDates",
					"Trip date context not recorded (legacy claim)",
				)}
		</span>
	);
}
