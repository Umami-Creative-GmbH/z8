import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { loadPayrollWorkBalanceEmployees } from "./coverage";
import { WorkBalancesHeader, WorkBalancesView } from "./work-balances-view";

/**
 * Work balances in the payroll area (#995): the employees the payroll access
 * grant covers, including those who have left, each opening their Work balance
 * section to record or cancel overtime payouts. Not found without an active
 * grant; owners and admins record payouts on the employee settings page.
 */
async function PayrollWorkBalancesContent() {
	const [auth, employees] = await Promise.all([
		getAuthContext(),
		loadPayrollWorkBalanceEmployees(),
	]);
	const organizationId = auth?.session.activeOrganizationId;
	if (!auth || !organizationId || !employees) notFound();

	return (
		<WorkBalancesView employees={employees} userId={auth.user.id} organizationId={organizationId} />
	);
}

function PayrollWorkBalancesLoading() {
	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
			<WorkBalancesHeader />
			<LoadingRegion
				label={{
					labelKey: "payroll.workBalances.loading",
					labelDefault: "Loading work balances",
				}}
				className="space-y-4"
				role="status"
			>
				<Skeleton aria-hidden="true" className="h-16 w-full" />
				<Skeleton aria-hidden="true" className="h-16 w-full" />
			</LoadingRegion>
		</div>
	);
}

export default function PayrollWorkBalancesPage() {
	return (
		<Suspense fallback={<PayrollWorkBalancesLoading />}>
			<PayrollWorkBalancesContent />
		</Suspense>
	);
}
