import type { useTranslate } from "@tolgee/react";
import type { PayrollLineKind } from "@/lib/travel-expenses/payroll-line-kind";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * A payroll line kind's label (#851, #854), as the wage-type mappings and
 * payroll readiness name it. Needs the `settings/payrollExport` namespace.
 */
// Literal keys keep the Tolgee extractor able to find every label.
export function payrollLineKindLabel(t: Translate, kind: PayrollLineKind): string {
	switch (kind) {
		case "per_diem_statutory":
			return t(
				"settings.payrollExport.expenseMappings.kind.perDiemStatutory",
				"Per diem: statutory share",
			);
		case "per_diem_excess":
			return t(
				"settings.payrollExport.expenseMappings.kind.perDiemExcess",
				"Per diem: taxable excess",
			);
		case "mileage_statutory":
			return t(
				"settings.payrollExport.expenseMappings.kind.mileageStatutory",
				"Mileage: statutory share",
			);
		case "mileage_excess":
			return t(
				"settings.payrollExport.expenseMappings.kind.mileageExcess",
				"Mileage: taxable excess",
			);
		case "receipt_transport":
			return t(
				"settings.payrollExport.expenseMappings.kind.receiptTransport",
				"Receipts: transport",
			);
		case "receipt_accommodation":
			return t(
				"settings.payrollExport.expenseMappings.kind.receiptAccommodation",
				"Receipts: accommodation",
			);
		case "receipt_meals":
			return t("settings.payrollExport.expenseMappings.kind.receiptMeals", "Receipts: meals");
		case "receipt_parking":
			return t("settings.payrollExport.expenseMappings.kind.receiptParking", "Receipts: parking");
		case "receipt_other":
			return t("settings.payrollExport.expenseMappings.kind.receiptOther", "Receipts: other");
	}
}
