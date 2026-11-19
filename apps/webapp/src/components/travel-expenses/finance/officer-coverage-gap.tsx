"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getExpenseOfficerCoverageGap } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryKeys } from "@/lib/query/keys";
import { Link } from "@/navigation";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { FinanceReadBoundary } from "./finance-read-boundary";
import { readFinanceResult } from "./finance-read-result";
import { useFinanceReadScope } from "./use-finance-command";

export const UNCOVERED_FINANCE_QUEUE_HREF = "/travel-expenses/finance?coverage=uncovered";

/**
 * The coverage-gap warning (#756): approved expenses awaiting reimbursement
 * that no expense officer can reimburse. Shown to owners and admins, only
 * while the organization has expense officers and something is uncovered.
 */
export function OfficerCoverageGapNotice() {
	return (
		<FinanceReadBoundary requireEmployee={false}>
			<OfficerCoverageReader />
		</FinanceReadBoundary>
	);
}

function OfficerCoverageReader() {
	const { t } = useTranslate();
	const scope = useFinanceReadScope();
	const { data, isError, isFetching, refetch } = useQuery({
		queryKey: [...queryKeys.travelExpenses.officerCoverageGap(), scope],
		queryFn: () => readFinanceResult(getExpenseOfficerCoverageGap()),
	});
	if (isError)
		return (
			<TravelExpenseLoadError
				message={t(
					"travelExpenses.finance.coverageGap.failed",
					"Coverage could not be checked. Please retry.",
				)}
				retry={() => {
					void refetch();
				}}
				isRetrying={isFetching}
			/>
		);
	if (!data || data.uncovered === 0) return null;
	return (
		<Alert role="status">
			<IconAlertTriangle aria-hidden="true" />
			<AlertTitle>
				{t(
					"travelExpenses.finance.coverageGap.title",
					"{count, plural, one {# approved expense awaits} other {# approved expenses await}} reimbursement that no expense officer covers",
					{ count: data.uncovered },
				)}
			</AlertTitle>
			<AlertDescription>
				<p>
					{t(
						"travelExpenses.finance.coverageGap.description",
						"No active expense officer who can record reimbursements has them in scope. Owners and admins can still record them, or widen an officer's scope.",
					)}
				</p>
				<Link
					href={UNCOVERED_FINANCE_QUEUE_HREF}
					className="font-medium text-foreground underline underline-offset-4"
				>
					{t("travelExpenses.finance.coverageGap.show", "Show these expenses")}
				</Link>
			</AlertDescription>
		</Alert>
	);
}
