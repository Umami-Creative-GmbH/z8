import type { useTranslate } from "@tolgee/react";
import { formatPlainDate, formatPlainDateRange } from "@/lib/travel-expenses/format";
import type { SettlementTitle } from "@/lib/travel-expenses/settlement-store";
import { reportName } from "../report-name";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * How finance lists name a report or legacy claim awaiting reimbursement: the
 * report's name (or an "Untitled …" fallback) and its dates, if any. Needs the
 * `travelExpenses` namespace.
 */
export function settlementTitle(
	t: Translate,
	locale: string,
	title: SettlementTitle,
): { name: string; dates: string | null } {
	switch (title.kind) {
		case "trip":
			return {
				name: reportName(t, { kind: "trip", itemType: null, title: title.purpose }),
				dates: formatPlainDateRange(locale, title.startDate, title.endDate),
			};
		case "standalone":
			return {
				name: reportName(t, { kind: "standalone", itemType: null, title: title.description }),
				dates: title.expenseDate ? formatPlainDate(locale, title.expenseDate) : null,
			};
		case "legacy_claim":
			return {
				name: t("travelExpenses.finance.legacyClaim", "Legacy {type} claim", {
					type: title.claimType.replace("_", " "),
				}),
				dates: formatPlainDateRange(locale, title.startDate, title.endDate),
			};
	}
}
