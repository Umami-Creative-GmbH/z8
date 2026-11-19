"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

/** Non-sensitive heading while an authorized record is not yet available. */
export function ReportArrivalHeading() {
	const { t } = useTranslate();
	return <PageHeader title={t("travelExpenses.report.items.title", "Expenses")} />;
}
