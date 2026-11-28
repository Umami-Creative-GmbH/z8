import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeBalanceLoadingHeading } from "@/components/payroll/employee-balance-loading-heading";
import { EmployeeBalanceWorkspace } from "@/components/payroll/employee-balance-workspace";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { readPersonalDetails } from "@/lib/organization/personal-details/personal-details";
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
	const organizationId = auth.session.activeOrganizationId;
	// The personal details module alone decides whether the holder may decide this
	// employee's personal details (#2071); the link appears only then.
	const personalDetails = await readPersonalDetails({
		organizationId,
		actorUserId: auth.user.id,
		employeeId: employee.id,
	});

	return (
		<EmployeeBalanceWorkspace
			employee={employee}
			organizationId={organizationId}
			userId={auth.user.id}
			decidesPersonalDetails={personalDetails?.viewer.mayChange === true}
		/>
	);
}

function PayrollWorkBalanceLoading() {
	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			<EmployeeBalanceLoadingHeading />
			<LoadingRegion
				label={{
					labelKey: "payroll.workBalances.loadingEmployee",
					labelDefault: "Loading the work balance",
				}}
				role="status"
			>
				<Skeleton aria-hidden="true" className="h-64 w-full" />
			</LoadingRegion>
		</div>
	);
}

export default function PayrollWorkBalancePage(props: PayrollWorkBalancePageProps) {
	return (
		<Suspense fallback={<PayrollWorkBalanceLoading />}>
			<PayrollWorkBalanceContent {...props} />
		</Suspense>
	);
}
