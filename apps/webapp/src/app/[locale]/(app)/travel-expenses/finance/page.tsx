import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/travel-expenses/back-link";
import { FinanceExports } from "@/components/travel-expenses/finance/finance-exports";
import { FinanceQueue } from "@/components/travel-expenses/finance/finance-queue";
import { OfficerCoverageGapNotice } from "@/components/travel-expenses/finance/officer-coverage-gap";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import { getTranslate } from "@/tolgee/server";

interface TravelExpenseFinancePageProps {
	/** `coverage=uncovered`: the coverage-gap warning's link (#756). */
	searchParams: Promise<{ coverage?: string | string[] }>;
}

/** Travel expense finance queue (#612): owners, admins and expense officers (#747). */
async function TravelExpenseFinancePageContent({ searchParams }: TravelExpenseFinancePageProps) {
	const [t, actor, params] = await Promise.all([getTranslate(), loadFinanceActor(), searchParams]);
	if (!actor?.canRead) notFound();
	const uncovered = params.coverage === "uncovered";
	return (
		<div className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:py-6 lg:px-6">
			<BackLink href="/travel-expenses">
				{t("travelExpenses.report.backToTravelExpenses", "Back to travel expenses")}
			</BackLink>
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("travelExpenses.finance.title", "Expense finance")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.finance.description",
						"Approved expenses and what is still owed to employees. Recording a reimbursement documents a payment made outside Z8; no money is transferred.",
					)}
				</p>
			</div>
			{uncovered ? (
				<FinanceQueue coverage="uncovered" />
			) : (
				<>
					<OfficerCoverageGapNotice />
					<FinanceQueue />
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
		<Suspense fallback={<TravelExpenseFinancePageLoading />}>
			<TravelExpenseFinancePageContent {...props} />
		</Suspense>
	);
}
