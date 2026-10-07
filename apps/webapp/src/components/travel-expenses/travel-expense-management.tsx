"use client";

import { useTranslate } from "@tolgee/react";
import { ExpenseHistory } from "./expense-history";
import {
	NewMileageExpenseButton,
	NewReceiptExpenseButton,
	NewTripReportButton,
} from "./report/new-receipt-expense-button";

interface TravelExpenseManagementProps {
	organizationId: string;
	employeeId: string;
}

/**
 * The Travel Expenses workspace (#617): create a trip or a standalone expense,
 * and find every report and earlier claim in one filterable history.
 */
export function TravelExpenseManagement({
	organizationId,
	employeeId,
}: TravelExpenseManagementProps) {
	const { t } = useTranslate();

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("travelExpenses.title", "Travel Expenses")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"travelExpenses.workspace.description",
							"Collect trip and standalone expenses, send them for review and follow their reimbursement.",
						)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2 sm:justify-end">
					<NewReceiptExpenseButton />
					<NewMileageExpenseButton />
					<NewTripReportButton />
				</div>
			</div>

			<div className="px-4 lg:px-6">
				<ExpenseHistory organizationId={organizationId} employeeId={employeeId} />
			</div>
		</div>
	);
}
