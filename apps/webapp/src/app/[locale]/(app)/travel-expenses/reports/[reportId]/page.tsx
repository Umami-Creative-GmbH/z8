import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseReportEditor } from "@/components/travel-expenses/report/travel-expense-report-editor";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

async function ReportContent({ params }: { params: Promise<{ reportId: string }> }) {
	const [t, actor, { reportId }] = await Promise.all([getTranslate(), getAuthContext(), params]);
	if (!actor?.employee)
		return <NoEmployeeError feature={t("travelExpenses.feature", "manage travel expenses")} />;
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
			<TravelExpenseReportEditor reportId={reportId} />
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
