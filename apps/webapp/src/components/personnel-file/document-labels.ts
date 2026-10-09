"use client";

import { useTranslate } from "@tolgee/react";
import { Temporal } from "temporal-polyfill";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type {
	DocumentCategory,
	DocumentVisibility,
	PayPeriod,
} from "@/lib/personnel-file/document.types";

/** Translated names of the document categories and visibilities (CONTEXT.md terms). */
export function usePersonnelFileLabels() {
	const { t } = useTranslate();
	const categories: Record<DocumentCategory, string> = {
		contract: t("settings.personnelFiles.categories.contract", "Contract"),
		payslip: t("settings.personnelFiles.categories.payslip", "Payslip"),
		certificate: t("settings.personnelFiles.categories.certificate", "Certificate"),
		sick_note: t("settings.personnelFiles.categories.sickNote", "Sick note"),
		other: t("settings.personnelFiles.categories.other", "Other"),
	};
	const visibilities: Record<DocumentVisibility, string> = {
		shared: t("settings.personnelFiles.visibility.shared", "Shared"),
		hr_only: t("settings.personnelFiles.visibility.hrOnly", "HR-only"),
	};
	return { categories, visibilities };
}

/** A pay period as the month name and year in the app language. */
export function formatPayPeriod(payPeriod: PayPeriod, locale: string): string {
	return formatPlainDate(
		Temporal.PlainDate.from({ year: payPeriod.year, month: payPeriod.month, day: 1 }),
		locale,
		"monthYear",
	);
}

export function formatFileSize(bytes: number, locale: string): string {
	const units = ["B", "KB", "MB"] as const;
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

export function personnelDocumentUrl(
	documentId: string,
	options: { download?: boolean; thumb?: boolean } = {},
): string {
	const params = new URLSearchParams();
	if (options.thumb) params.set("variant", "thumb");
	if (options.download) params.set("download", "1");
	const query = params.toString();
	return `/api/personnel-files/documents/${documentId}${query ? `?${query}` : ""}`;
}
