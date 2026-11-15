import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeDirectoryCard } from "@/components/employees/employee-directory-card";
import { OpeningBalanceUploadDialog } from "@/components/settings/work-balance/opening-balance-upload-dialog";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { loadPayrollWorkBalanceEmployees } from "./coverage";

/**
 * Work balances in the payroll area (#995): the employees the payroll access
 * grant covers, including those who have left, each opening their Work balance
 * section to record or cancel overtime payouts. Not found without an active
 * grant; owners and admins record payouts on the employee settings page.
 */
async function PayrollWorkBalancesContent() {
	const [t, employees] = await Promise.all([
		getTranslate(),
		loadPayrollWorkBalanceEmployees(),
	]);
	if (!employees) notFound();

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Link
					href="/payroll"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("payroll.workBalances.backToPayroll", "Payroll")}
				</Link>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("payroll.workBalances.title", "Work balances")}
						</h1>
						<p className="text-muted-foreground">
							{t(
								"payroll.workBalances.description",
								"Record and cancel overtime payouts for the employees your payroll access covers, including employees who have left.",
							)}
						</p>
					</div>
					{employees.length > 0 ? <OpeningBalanceUploadDialog /> : null}
				</div>
			</header>
			{employees.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"payroll.workBalances.empty",
						"No employees are in your payroll access scope yet.",
					)}
				</p>
			) : (
				<EmployeeDirectoryCard
					employees={employees}
					basePath="/payroll/work-balances"
					formerEmployeeLabel={t(
						"payroll.workBalances.former",
						"Former employee",
					)}
				/>
			)}
		</div>
	);
}

function PayrollWorkBalancesLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "payroll.workBalances.loading",
				labelDefault: "Loading work balances",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-16 w-full" />
			<Skeleton aria-hidden="true" className="h-16 w-full" />
		</LoadingRegion>
	);
}

export default function PayrollWorkBalancesPage() {
	return (
		<Suspense fallback={<PayrollWorkBalancesLoading />}>
			<PayrollWorkBalancesContent />
		</Suspense>
	);
}
