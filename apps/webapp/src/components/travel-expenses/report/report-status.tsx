"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { TravelExpenseReportStatus } from "@/db/schema/travel-expense";
import { parseInstant } from "@/lib/datetime/temporal-core";

/** Review status of an expense report (#602). */
export function ReportStatusBadge({ status }: { status: TravelExpenseReportStatus }) {
	const { t } = useTranslate();
	switch (status) {
		case "draft":
			return <Badge variant="secondary">{t("travelExpenses.status.draft", "Draft")}</Badge>;
		case "submitted":
			return (
				<Badge variant="outline">
					{t("travelExpenses.report.status.submitted", "Awaiting review")}
				</Badge>
			);
		case "approved":
			return <Badge>{t("travelExpenses.report.status.approved", "Approved")}</Badge>;
		case "rejected":
			return (
				<Badge variant="destructive">
					{t("travelExpenses.report.status.rejected", "Rejected")}
				</Badge>
			);
		case "returned":
			return (
				<Badge
					variant="outline"
					className="border-amber-500/60 text-amber-700 dark:border-amber-400/60 dark:text-amber-300"
				>
					{t("travelExpenses.report.status.returned", "Returned for changes")}
				</Badge>
			);
	}
}

/**
 * A recorded instant (submission, decision) shown in UTC with its zone, like
 * the claim history: never in the viewer's zone.
 */
export function formatRecordedInstant(locale: string, iso: string): string {
	try {
		return `${parseInstant(iso)
			.toZonedDateTimeISO("UTC")
			.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} UTC`;
	} catch {
		return iso;
	}
}
