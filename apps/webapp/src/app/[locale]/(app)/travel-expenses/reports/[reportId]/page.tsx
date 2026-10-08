import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { BackLink } from "@/components/travel-expenses/back-link";
import { SubmittedTravelExpenseReport } from "@/components/travel-expenses/report/submitted-report";
import { TravelExpenseReportEditor } from "@/components/travel-expenses/report/travel-expense-report-editor";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { getAuthContext } from "@/lib/auth-helpers";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import { loadAuthorizedTravelExpenseReport } from "@/lib/travel-expenses/report-read";
import { getTranslate } from "@/tolgee/server";

type ReportPageProps = {
	params: Promise<{ reportId: string }>;
	searchParams: Promise<{ cycle?: string | string[] }>;
};

/** An earlier submission cycle named by `?cycle=` (#603); undefined for the current report. */
function requestedCycle(value: string | string[] | undefined): number | undefined {
	const cycle = typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isInteger(cycle) && cycle > 0 ? cycle : undefined;
}

async function ReportContent({ params, searchParams }: ReportPageProps) {
	const [t, actor, { reportId }, search] = await Promise.all([
		getTranslate(),
		getAuthContext(),
		params,
		searchParams,
	]);
	const cycle = requestedCycle(search.cycle);
	if (!actor?.employee)
		return <NoEmployeeError feature={t("travelExpenses.feature", "manage travel expenses")} />;
	const authorized = await loadAuthorizedTravelExpenseReport(reportId);
	if (authorized.status !== "found") notFound();
	if (authorized.access !== "owner") {
		// Reviewers see only the frozen submission the Approvals inbox lets them
		// decide; finance (#612) sees the approved frozen submission and its settlement.
		// An approved report has left the inbox, so its reviewer with finance access
		// goes back to expense finance too.
		const financeReader =
			authorized.access === "finance" ||
			(authorized.report.status === "approved" && Boolean((await loadFinanceActor())?.canRead));
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:py-6 lg:px-6">
				{financeReader ? (
					<BackLink href="/travel-expenses/finance">
						{t("travelExpenses.finance.back", "Back to expense finance")}
					</BackLink>
				) : (
					<BackLink href="/approvals/inbox">
						{t("travelExpenses.report.backToApprovals", "Back to approvals")}
					</BackLink>
				)}
				<SubmittedTravelExpenseReport reportId={reportId} cycle={cycle} />
			</div>
		);
	}
	return (
		<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:py-6 lg:px-6">
			{cycle === undefined ? (
				<>
					<BackLink href="/travel-expenses">
						{t("travelExpenses.report.backToTravelExpenses", "Back to travel expenses")}
					</BackLink>
					<TravelExpenseReportEditor
						reportId={reportId}
						maxReceiptBytes={Number(env.TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES)}
					/>
				</>
			) : (
				<>
					{/* An earlier submission is reached from the current report, so it leads back there. */}
					<BackLink href={`/travel-expenses/reports/${reportId}`}>
						{t("travelExpenses.report.backToCurrent", "Back to the current report")}
					</BackLink>
					<SubmittedTravelExpenseReport reportId={reportId} cycle={cycle} />
				</>
			)}
		</div>
	);
}

export default function TravelExpenseReportPage(props: ReportPageProps) {
	return (
		<Suspense
			fallback={
				<LoadingRegion
					label={{
						labelKey: "common.loadingRegions.travelExpenses",
						labelDefault: "Loading travel expenses",
					}}
					role="status"
					className="mx-auto w-full max-w-3xl px-4 py-4 md:py-6 lg:px-6"
				>
					<Skeleton aria-hidden="true" className="h-96 w-full" />
				</LoadingRegion>
			}
		>
			<ReportContent {...props} />
		</Suspense>
	);
}
