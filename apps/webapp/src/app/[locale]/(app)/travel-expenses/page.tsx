import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseApprovalsEntry } from "@/components/travel-expenses/approvals-entry";
import { TravelExpenseFinanceEntry } from "@/components/travel-expenses/finance/finance-entry";
import { TravelExpenseManagement } from "@/components/travel-expenses/travel-expense-management";
import { LoadingRegion } from "@/components/ui/loading-region";
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
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("travelExpenses.feature", "manage travel expenses")} />
			</div>
		);
	}

	const reviewsApprovals =
		authContext.employee.role === "manager" || authContext.employee.role === "admin";
	const readsFinance = Boolean(financeActor?.canRead);
	return (
		<TravelExpenseManagement
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

function TravelExpensesPageLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.travelExpenses",
				labelDefault: "Loading travel expenses",
			}}
			className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6"
			role="status"
		>
			<div className="space-y-4 px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-8 w-64" />
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
