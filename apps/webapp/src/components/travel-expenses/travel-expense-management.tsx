"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getMyTravelExpenseClaims } from "@/app/[locale]/(app)/travel-expenses/actions";
import { queryKeys } from "@/lib/query";
import { NewReceiptExpenseButton, NewTripReportButton } from "./report/new-receipt-expense-button";
import { TravelExpenseReportDrafts } from "./report/travel-expense-report-drafts";
import { TravelExpenseList } from "./travel-expense-list";
import { TravelExpenseLoadError } from "./travel-expense-load-error";

interface TravelExpenseManagementProps {
	organizationId: string;
	employeeId: string;
}

export function TravelExpenseManagement({
	organizationId,
	employeeId,
}: TravelExpenseManagementProps) {
	const { t } = useTranslate();

	const queryKey = queryKeys.travelExpenses.list({
		organizationId,
		employeeId,
	});

	const { data, isLoading, isFetching, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getMyTravelExpenseClaims();
			if (!result.success) {
				throw new Error(
					result.error ||
						t("travelExpenses.errors.loadClaims", "Failed to load travel expense claims"),
				);
			}
			return result.data;
		},
	});

	const claims = data || [];

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("travelExpenses.title", "Travel Expenses")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("travelExpenses.description", "Create and track your travel expense claims")}
					</p>
				</div>
				<div className="flex flex-wrap justify-end gap-2">
					<NewReceiptExpenseButton />
					<NewTripReportButton />
				</div>
			</div>

			<div className="space-y-3 px-4 lg:px-6">
				<TravelExpenseReportDrafts />
			</div>

			<div className="space-y-3 px-4 lg:px-6">
				{isError && (
					<TravelExpenseLoadError
						message={t(
							"travelExpenses.errors.loadClaimsRetry",
							"Unable to load claims. Please retry.",
						)}
						retry={() => {
							void refetch();
						}}
						isRetrying={isFetching}
					/>
				)}
				{isFetching && data !== undefined && (
					<p role="status" className="text-sm text-muted-foreground">
						{t("travelExpenses.list.refreshing", "Refreshing claims…")}
					</p>
				)}
				{(!isError || data !== undefined) && (
					<TravelExpenseList claims={claims} isLoading={isLoading} />
				)}
			</div>
		</div>
	);
}
