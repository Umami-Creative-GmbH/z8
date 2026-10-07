import type { useTranslate } from "@tolgee/react";
import type { travelExpenseClaimStatusEnum, travelExpenseTypeEnum } from "@/db/schema/enums";

type Translate = ReturnType<typeof useTranslate>["t"];
type LegacyClaimType = (typeof travelExpenseTypeEnum.enumValues)[number];
type LegacyClaimStatus = (typeof travelExpenseClaimStatusEnum.enumValues)[number];

// Static keys keep the labels extractable; they share the report copy (#680).
export function legacyClaimTypeLabel(t: Translate, type: LegacyClaimType) {
	switch (type) {
		case "receipt":
			return t("travelExpenses.report.receipts.title", "Receipt");
		case "mileage":
			return t("travelExpenses.report.mileage.standaloneTitle", "Mileage");
		case "per_diem":
			return t("travelExpenses.report.perDiem.title", "Per diem");
	}
}

export function legacyClaimStatusLabel(t: Translate, status: LegacyClaimStatus) {
	switch (status) {
		case "draft":
			return t("travelExpenses.status.draft", "Draft");
		case "submitted":
			return t("travelExpenses.report.status.submitted", "Awaiting review");
		case "approved":
			return t("travelExpenses.report.status.approved", "Approved");
		case "rejected":
			return t("travelExpenses.report.status.rejected", "Rejected");
	}
}
