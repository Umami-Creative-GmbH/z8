import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { BackLink } from "@/components/travel-expenses/back-link";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

async function ClaimContent({
	params,
}: {
	params: Promise<{ claimId: string }>;
}) {
	const [t, actor, { claimId }] = await Promise.all([
		getTranslate(),
		getAuthContext(),
		params,
	]);
	if (!actor?.employee)
		return (
			<NoEmployeeError
				feature={t("travelExpenses.feature", "manage travel expenses")}
			/>
		);
	return (
		<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:py-6 lg:px-6">
			<BackLink href="/travel-expenses">
				{t("travelExpenses.report.backToTravelExpenses", "Back to travel expenses")}
			</BackLink>
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("travelExpenses.detail.title", "Travel expense claim")}
			</h1>
			<TravelExpenseClaimDetail
				claimId={claimId}
				organizationId={actor.employee.organizationId}
				employeeId={actor.employee.id}
			/>
		</div>
	);
}
export default function TravelExpenseClaimPage(props: {
	params: Promise<{ claimId: string }>;
}) {
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
					<Skeleton aria-hidden="true" className="h-48 w-full" />
				</LoadingRegion>
			}
		>
			<ClaimContent {...props} />
		</Suspense>
	);
}
