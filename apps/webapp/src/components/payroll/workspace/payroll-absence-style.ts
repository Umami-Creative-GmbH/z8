import type { CSSProperties } from "react";
import type { PayrollPeriodDayAbsence } from "@/lib/payroll-period/types";
import { absenceCategoryColor } from "@/components/absences/category-color";

/** Diagonal stripes over a category colour mark an absence that is still pending. */
export const PENDING_HATCH =
	"repeating-linear-gradient(135deg, transparent 0 3px, rgb(255 255 255 / 0.65) 3px 5px)";

export interface PayrollAbsenceLegendCategory {
	categoryId: string;
	categoryName: string;
	color: string;
}

/** The categories of the absences shown, in name order, each with its calendar colour. */
export function payrollAbsenceLegend(
	absences: readonly Pick<
		PayrollPeriodDayAbsence,
		"categoryId" | "categoryName" | "categoryType" | "categoryColor"
	>[],
): PayrollAbsenceLegendCategory[] {
	const categories = new Map<string, PayrollAbsenceLegendCategory>();
	for (const absence of absences) {
		if (categories.has(absence.categoryId)) continue;
		categories.set(absence.categoryId, {
			categoryId: absence.categoryId,
			categoryName: absence.categoryName,
			color: absenceCategoryColor(absence.categoryType, absence.categoryColor),
		});
	}
	return [...categories.values()].toSorted((left, right) =>
		left.categoryName.localeCompare(right.categoryName),
	);
}

export function absenceSwatchStyle(
	absence: Pick<PayrollPeriodDayAbsence, "categoryType" | "categoryColor" | "approvalState">,
): CSSProperties {
	const color = absenceCategoryColor(absence.categoryType, absence.categoryColor);
	return absence.approvalState === "pending"
		? { backgroundColor: color, backgroundImage: PENDING_HATCH, outlineColor: color }
		: { backgroundColor: color };
}
