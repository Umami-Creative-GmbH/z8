import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseApprovalsEntry } from "@/components/travel-expenses/approvals-entry";
import { TravelExpenseFinanceEntry } from "@/components/travel-expenses/finance/finance-entry";
import { TravelExpenseManagement } from "@/components/travel-expenses/travel-expense-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import { getTranslate } from "@/tolgee/server";

async function TravelExpensesPageContent() {
	const [t, authContext, financeActor] = await Promise.all([
		getTranslate(),
		getAuthContext(),
		loadFinanceActor(),
	]);

	if (!authContext?.employee) {
		return (
			<div className="@container/main page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={t("travelExpenses.title", "Travel Expenses")} />
				<NoEmployeeError feature={t("travelExpenses.feature", "manage travel expenses")} />
			</div>
		);
	}

	const reviewsApprovals =
		authContext.employee.role === "manager" || authContext.employee.role === "admin";
	const readsFinance = Boolean(financeActor?.canRead);
	return (
		<TravelExpenseManagement
			userId={authContext.user.id}
			organizationId={authContext.employee.organizationId}
			employeeId={authContext.employee.id}
			banners={
				reviewsApprovals || readsFinance ? (
					<>
						{reviewsApprovals && <TravelExpenseApprovalsEntry />}
						{readsFinance && <TravelExpenseFinanceEntry />}
					</>
				) : null
			}
		/>
	);
}

async function TravelExpensesPageLoading() {
	const t = await getTranslate();
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.travelExpenses",
				labelDefault: "Loading travel expenses",
			}}
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			role="status"
		>
			<div className="space-y-4">
				<PageHeader title={t("travelExpenses.title", "Travel Expenses")} />
				<Skeleton aria-hidden="true" className="h-4 w-80 max-w-full" />
				<Skeleton aria-hidden="true" className="h-96 w-full" />
			</div>
		</LoadingRegion>
	);
}

export default function TravelExpensesPage() {
	return (
		<Suspense fallback={<TravelExpensesPageLoading />}>
			<TravelExpensesPageContent />
		</Suspense>
	);
}
