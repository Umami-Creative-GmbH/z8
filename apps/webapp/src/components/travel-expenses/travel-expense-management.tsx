"use client";

import { useTranslate } from "@tolgee/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/auth-client";
import type { ExpenseHistoryFilter } from "@/lib/travel-expenses/expense-history";
import { ExpenseHistory } from "./expense-history";
import {
	NewMileageExpenseButton,
	NewReceiptExpenseButton,
	NewTripReportButton,
} from "./report/new-receipt-expense-button";

interface TravelExpenseManagementProps {
	userId: string;
	organizationId: string;
	employeeId: string;
	/** Independent server-authorized destinations, after personal history. */
	banners?: ReactNode;
}

/**
 * The Travel Expenses workspace (#617): create a trip or a standalone expense,
 * and find every report and earlier claim in one filterable history.
 */
export function TravelExpenseManagement({
	userId,
	organizationId,
	employeeId,
	banners,
}: TravelExpenseManagementProps) {
	const current = useOrganization();
	const session = useSession();
	const { t } = useTranslate();
	const matches =
		!session.isPending &&
		session.data?.user.id === userId &&
		session.data.session.activeOrganizationId === organizationId &&
		current.userId === userId &&
		current.activeOrganizationId === organizationId &&
		current.employeeId === employeeId;
	const [arrival, setArrival] = useState(0);
	const [filter, setFilter] = useState<ExpenseHistoryFilter>("all");
	const initialized = useRef(false);
	// Activity disconnects effects. A restored page gets a fresh read/command lifetime
	// before paint, even when it returns to the same account and organization.
	useLayoutEffect(() => {
		if (initialized.current) setArrival((value) => value + 1);
		initialized.current = true;
	}, []);
	if (!matches)
		return (
			<div className="page-frame space-y-4">
				<PageHeader title={t("travelExpenses.title", "Travel Expenses")} />
				<p role="status">
					{t(
						"travelExpenses.workspace.reconciling",
						"Loading your expenses for the current organization…",
					)}
				</p>
			</div>
		);
	return (
		<TravelExpenseWorkspace
			key={arrival}
			organizationId={organizationId}
			employeeId={employeeId}
			banners={banners}
			filter={filter}
			setFilter={setFilter}
		/>
	);
}

function TravelExpenseWorkspace({
	organizationId,
	employeeId,
	banners,
	filter,
	setFilter,
}: Omit<TravelExpenseManagementProps, "userId"> & {
	filter: ExpenseHistoryFilter;
	setFilter: (filter: ExpenseHistoryFilter) => void;
}) {
	const { t } = useTranslate();

	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			<PageHeader
				title={t("travelExpenses.title", "Travel Expenses")}
				description={t(
					"travelExpenses.workspace.description",
					"Collect trip and standalone expenses, send them for review and follow their reimbursement.",
				)}
			/>
			<section
				aria-label={t("travelExpenses.workspace.create", "Create an expense report")}
				className="grid gap-3 sm:grid-cols-3"
			>
				<NewReceiptExpenseButton />
				<NewMileageExpenseButton />
				<NewTripReportButton />
			</section>

			<div>
				<ExpenseHistory
					organizationId={organizationId}
					employeeId={employeeId}
					filter={filter}
					setFilter={setFilter}
				/>
			</div>
			{banners && (
				<aside
					aria-label={t("travelExpenses.workspace.otherWork", "Review and finance")}
					className="grid gap-3 lg:grid-cols-2"
				>
					{banners}
				</aside>
			)}
		</div>
	);
}
