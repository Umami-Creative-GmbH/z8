import type { TravelExpenseReportItemType } from "@/db/schema/travel-expense";

/** The translate function of `useTranslate`, narrowed to what these labels need. */
type Translate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

/** The type of an expense item: receipt, mileage or per diem. */
export function itemTypeLabel(t: Translate, type: TravelExpenseReportItemType): string {
	switch (type) {
		case "receipt":
			return t("travelExpenses.report.receipts.title", "Receipt");
		case "mileage":
			return t("travelExpenses.report.mileage.standaloneTitle", "Mileage");
		case "per_diem":
			return t("travelExpenses.report.perDiem.title", "Per diem");
	}
}

/**
 * An expense item's display title (#688): its type and its running number
 * over the report's items in position order, such as "Receipt 1". Nothing
 * persists it; exports keep their raw item position.
 */
export function itemTitle(t: Translate, type: TravelExpenseReportItemType, number: number): string {
	return t("travelExpenses.report.items.numbered", "{type} {number}", {
		type: itemTypeLabel(t, type),
		number,
	});
}

/** An item a note was written on that the report no longer has. */
export function removedItemTitle(t: Translate, type: TravelExpenseReportItemType): string {
	return t("travelExpenses.report.items.removed", "{type} (removed)", {
		type: itemTypeLabel(t, type),
	});
}
