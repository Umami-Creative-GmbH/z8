import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { Link } from "@/navigation";
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
		<div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 lg:px-6">
			<Link
				className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
				href="/travel-expenses"
			>
				{t("travelExpenses.actions.backToClaims", "Back to claims")}
			</Link>
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
					className="p-6"
				>
					<Skeleton aria-hidden="true" className="h-48 w-full" />
				</LoadingRegion>
			}
		>
			<ClaimContent {...props} />
		</Suspense>
	);
}
