"use client";

import { useTranslate } from "@tolgee/react";
import { useMemo } from "react";
import { useDisplayContext } from "@/hooks/use-display-context";

/**
 * Formats project report hours for the viewer's locale. `hours` and
 * `compactHours` add the unit from Tolgee; `number` and `compactNumber` are for
 * messages that carry the unit themselves.
 */
export function useProjectHoursFormat() {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	return useMemo(() => {
		// One decimal always, for totals and figures that are compared side by side.
		const fixed = new Intl.NumberFormat(locale, {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1,
		});
		// Up to one decimal, for chart ticks and budgets that are usually whole hours.
		const compact = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
		const withUnit = (hours: string) => t("reports.projects.hoursValue", "{hours} h", { hours });
		return {
			number: (value: number) => fixed.format(value),
			compactNumber: (value: number) => compact.format(value),
			hours: (value: number) => withUnit(fixed.format(value)),
			compactHours: (value: number) => withUnit(compact.format(value)),
		};
	}, [locale, t]);
}
