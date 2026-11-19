import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeBalanceWorkspace } from "@/components/payroll/employee-balance-workspace";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

import { loadPayrollWorkBalanceEmployees } from "../coverage";

interface PayrollWorkBalancePageProps {
	params: Promise<{ employeeId: string }>;
}

/**
 * One employee's Work balance section in the payroll area (#995), for the
 * holder of a payroll access grant that covers the employee, also after they
 * left. Not found for everyone else.
 */
async function PayrollWorkBalanceContent({ params }: PayrollWorkBalancePageProps) {
	const { employeeId } = await params;
	if (!isCanonicalUuid(employeeId)) notFound();
	const [employee] = (await loadPayrollWorkBalanceEmployees(employeeId)) ?? [];
	const auth = await getAuthContext();
	if (!employee || !auth?.session.activeOrganizationId) notFound();

	return (
		<EmployeeBalanceWorkspace
			employee={employee}
			organizationId={auth.session.activeOrganizationId}
			userId={auth.user.id}
		/>
	);
}

function PayrollWorkBalanceLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "payroll.workBalances.loadingEmployee",
				labelDefault: "Loading the work balance",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function PayrollWorkBalancePage(props: PayrollWorkBalancePageProps) {
	return (
		<Suspense fallback={<PayrollWorkBalanceLoading />}>
			<PayrollWorkBalanceContent {...props} />
		</Suspense>
	);
}
