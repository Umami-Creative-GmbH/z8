import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FinanceExports } from "@/components/travel-expenses/finance/finance-exports";
import { FinanceQueue } from "@/components/travel-expenses/finance/finance-queue";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/** Travel expense finance queue (#612): only with the TravelExpenseFinance read permission. */
async function TravelExpenseFinancePageContent() {
	const [t, actor] = await Promise.all([getTranslate(), loadFinanceActor()]);
	if (!actor?.canRead) notFound();
	return (
		<div className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:py-6 lg:px-6">
			<Link
				className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
				href="/travel-expenses"
			>
				{t("travelExpenses.report.backToTravelExpenses", "Back to travel expenses")}
			</Link>
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
			<FinanceQueue />
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

export default function TravelExpenseFinancePage() {
	return (
		<Suspense fallback={<TravelExpenseFinancePageLoading />}>
			<TravelExpenseFinancePageContent />
		</Suspense>
	);
}
