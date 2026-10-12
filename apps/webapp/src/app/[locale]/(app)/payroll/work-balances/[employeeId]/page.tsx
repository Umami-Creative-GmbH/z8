import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeWorkBalanceSection } from "@/components/settings/work-balance/employee-work-balance-section";
import { Badge } from "@/components/ui/badge";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
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
	const [t, { employeeId }] = await Promise.all([getTranslate(), params]);
	if (!isCanonicalUuid(employeeId)) notFound();
	const [employee] = (await loadPayrollWorkBalanceEmployees(employeeId)) ?? [];
	if (!employee) notFound();

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Link
					href="/payroll/work-balances"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("payroll.workBalances.back", "Work balances")}
				</Link>
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">{employee.name}</h1>
					{employee.isActive ? null : (
						<Badge variant="secondary">{t("payroll.workBalances.former", "Former employee")}</Badge>
					)}
				</div>
			</header>
			<EmployeeWorkBalanceSection employeeId={employee.id} />
		</div>
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
