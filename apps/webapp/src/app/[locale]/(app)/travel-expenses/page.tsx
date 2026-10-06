import { IconArrowRight, IconInbox } from "@tabler/icons-react";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseManagement } from "@/components/travel-expenses/travel-expense-management";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { TravelExpenseFinanceEntry } from "@/components/travel-expenses/finance/finance-entry";
import { getAuthContext } from "@/lib/auth-helpers";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import { Link } from "@/navigation";
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
				<NoEmployeeError
					feature={t("travelExpenses.feature", "manage travel expenses")}
				/>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-4 py-4 md:py-6">
			{(authContext.employee.role === "manager" ||
				authContext.employee.role === "admin") && (
				<div className="px-4 lg:px-6">
					<Alert>
						<IconInbox aria-hidden="true" className="size-4" />
						<AlertTitle>
							{t(
								"travelExpenses.approvals.title",
								"Review Pending Travel Expense Approvals",
							)}
						</AlertTitle>
						<AlertDescription className="flex items-center justify-between gap-4">
							<span>
								{t(
									"travelExpenses.approvals.description",
									"Open the unified approvals inbox filtered to travel expenses.",
								)}
							</span>
							<Button asChild size="sm" variant="outline">
								<Link href="/approvals/inbox?types=travel_expense_claim">
									{t("travelExpenses.approvals.openInbox", "Open Inbox")}
									<IconArrowRight aria-hidden="true" className="ml-2 size-4" />
								</Link>
							</Button>
						</AlertDescription>
					</Alert>
				</div>
			)}
			{financeActor?.canRead && (
				<div className="px-4 lg:px-6">
					<TravelExpenseFinanceEntry />
				</div>
			)}

			<TravelExpenseManagement
				organizationId={authContext.employee.organizationId}
				employeeId={authContext.employee.id}
			/>
		</div>
	);
}

function TravelExpensesPageLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.travelExpenses",
				labelDefault: "Loading travel expenses",
			}}
			className="@container/main flex flex-1 flex-col gap-4 py-4 md:py-6"
			role="status"
		>
			<div className="space-y-4 px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-24 w-full" />
				<Skeleton aria-hidden="true" className="h-10 w-64" />
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
