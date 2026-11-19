"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "../back-link";

/** Safe task identity also renders while finance admission is loading. */
export function FinanceHeading() {
	const { t } = useTranslate();
	return (
		<PageHeader
			scope={
				<BackLink href="/travel-expenses">
					{t("travelExpenses.report.backToTravelExpenses", "Back to travel expenses")}
				</BackLink>
			}
			title={t("travelExpenses.finance.title", "Expense finance")}
			description={t(
				"travelExpenses.finance.description",
				"Approved expenses and what is still owed to employees. Recording a reimbursement documents a payment made outside Z8; no money is transferred.",
			)}
		/>
	);
}
