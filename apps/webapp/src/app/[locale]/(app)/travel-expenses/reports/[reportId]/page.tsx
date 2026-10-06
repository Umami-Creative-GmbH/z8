import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { SubmittedTravelExpenseReport } from "@/components/travel-expenses/report/submitted-report";
import { TravelExpenseReportEditor } from "@/components/travel-expenses/report/travel-expense-report-editor";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { getAuthContext } from "@/lib/auth-helpers";
import { loadAuthorizedTravelExpenseReport } from "@/lib/travel-expenses/report-read";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

async function ReportContent({ params }: { params: Promise<{ reportId: string }> }) {
	const [t, actor, { reportId }] = await Promise.all([getTranslate(), getAuthContext(), params]);
	if (!actor?.employee)
		return <NoEmployeeError feature={t("travelExpenses.feature", "manage travel expenses")} />;
	const authorized = await loadAuthorizedTravelExpenseReport(reportId);
	if (authorized.status !== "found") notFound();
	if (authorized.access !== "owner") {
		// Reviewers see only the frozen submission the Approvals inbox lets them
		// decide; finance (#612) sees the approved frozen submission and its settlement.
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 lg:px-6">
				{authorized.access === "finance" ? (
					<Link
						className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
						href="/travel-expenses/finance"
					>
						{t("travelExpenses.finance.back", "Back to expense finance")}
					</Link>
				) : (
					<Link
						className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
						href="/approvals/inbox"
					>
						{t("travelExpenses.report.backToApprovals", "Back to approvals")}
					</Link>
				)}
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("travelExpenses.report.submittedTitle", "Submitted expense report")}
				</h1>
				<SubmittedTravelExpenseReport reportId={reportId} />
			</div>
		);
	}
	return (
		<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 lg:px-6">
			<Link
				className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
				href="/travel-expenses"
			>
				{t("travelExpenses.report.backToTravelExpenses", "Back to travel expenses")}
			</Link>
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("travelExpenses.report.title", "Expense")}
			</h1>
			<TravelExpenseReportEditor
				reportId={reportId}
				maxReceiptBytes={Number(env.TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES)}
			/>
		</div>
	);
}

export default function TravelExpenseReportPage(props: { params: Promise<{ reportId: string }> }) {
	return (
		<Suspense
			fallback={
				<LoadingRegion
					label={{
						labelKey: "common.loadingRegions.travelExpenses",
						labelDefault: "Loading travel expenses",
					}}
					role="status"
					className="p-6"
				>
					<Skeleton aria-hidden="true" className="h-96 w-full" />
				</LoadingRegion>
			}
		>
			<ReportContent {...props} />
		</Suspense>
	);
}
