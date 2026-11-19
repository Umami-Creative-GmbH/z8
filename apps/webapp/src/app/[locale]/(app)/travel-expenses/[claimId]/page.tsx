import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { BackLink } from "@/components/travel-expenses/back-link";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

async function ClaimContent({ params }: { params: Promise<{ claimId: string }> }) {
	const [t, actor, { claimId }] = await Promise.all([getTranslate(), getAuthContext(), params]);
	if (!actor?.employee)
		return <NoEmployeeError feature={t("travelExpenses.feature", "manage travel expenses")} />;
	return (
		<TravelExpenseClaimDetail
			userId={actor.user.id}
			claimId={claimId}
			organizationId={actor.employee.organizationId}
			employeeId={actor.employee.id}
		/>
	);
}
export default async function TravelExpenseClaimPage(props: {
	params: Promise<{ claimId: string }>;
}) {
	const t = await getTranslate();
	return (
		<div className="page-frame min-w-0">
			<div className="page-measure space-y-6">
				<PageHeader
					scope={
						<BackLink href="/travel-expenses">
							{t("travelExpenses.report.backToTravelExpenses", "Back to travel expenses")}
						</BackLink>
					}
					title={t("travelExpenses.detail.title", "Travel expense claim")}
				/>
				<Suspense
					fallback={
						<LoadingRegion
							label={{
								labelKey: "common.loadingRegions.travelExpenses",
								labelDefault: "Loading travel expenses",
							}}
							role="status"
						>
							<Skeleton aria-hidden="true" className="h-48 w-full" />
						</LoadingRegion>
					}
				>
					<ClaimContent {...props} />
				</Suspense>
			</div>
		</div>
	);
}
