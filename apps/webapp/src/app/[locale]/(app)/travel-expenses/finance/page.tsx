import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FinanceExports } from "@/components/travel-expenses/finance/finance-exports";
import { FinanceHeading } from "@/components/travel-expenses/finance/finance-heading";
import { FinanceQueue } from "@/components/travel-expenses/finance/finance-queue";
import { OfficerCoverageGapNotice } from "@/components/travel-expenses/finance/officer-coverage-gap";
import { PayrollRunsToConfirm } from "@/components/travel-expenses/finance/payroll-runs-to-confirm";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import { parseConfirmRun } from "@/lib/travel-expenses/finance-queue-params";

interface TravelExpenseFinancePageProps {
	/**
	 * `coverage=uncovered`: the coverage-gap warning's link (#756).
	 * `confirmRun=<jobId>`: a payroll run notification's link (#855).
	 */
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Travel expense finance queue (#612): owners, admins and expense officers (#747). */
async function TravelExpenseFinancePageContent({ searchParams }: TravelExpenseFinancePageProps) {
	const [actor, params] = await Promise.all([loadFinanceActor(), searchParams]);
	if (!actor?.canRead) notFound();
	const uncovered = params.coverage === "uncovered";
	return (
		<div className="space-y-6">
			{uncovered ? (
				<FinanceQueue coverage="uncovered" />
			) : (
				<>
					<FinanceQueue />
					<OfficerCoverageGapNotice />
					{actor.canSettle && <PayrollRunsToConfirm openJobId={parseConfirmRun(params)} />}
				</>
			)}
			{actor.canExport && <FinanceExports />}
		</div>
	);
}

function TravelExpenseFinancePageLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.travelExpenses",
				labelDefault: "Loading travel expenses",
			}}
			role="status"
			className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:py-6 lg:px-6"
		>
			<Skeleton aria-hidden="true" className="h-8 w-64" />
			<Skeleton aria-hidden="true" className="h-96 w-full" />
		</LoadingRegion>
	);
}

export default function TravelExpenseFinancePage(props: TravelExpenseFinancePageProps) {
	return (
		<div className="@container/main flex min-w-0 flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
			<FinanceHeading />
			<Suspense fallback={<TravelExpenseFinancePageLoading />}>
				<TravelExpenseFinancePageContent {...props} />
			</Suspense>
		</div>
	);
}
