import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ScheduledExportsTable } from "@/components/settings/scheduled-exports/scheduled-exports-table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getScheduledExportsAction,
	getFilterOptionsAction,
	getPayrollConfigsAction,
} from "./actions";

export const metadata = {
	title: "Scheduled Exports",
	description: "Configure recurring exports for payroll, data, and audit reports",
};

async function ScheduledExportsContent() {
	await connection(); // Mark as fully dynamic

	const [t, currentEmployee] = await Promise.all([getTranslate(), getCurrentEmployee()]);

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t("settings.scheduledExports.featureName", "Scheduled Exports")}
				/>
			</div>
		);
	}

	const authContext = await getAuthContext();

	if (!authContext?.employee || authContext.employee.role !== "admin") {
		redirect("/");
	}

	const organizationId = authContext.employee.organizationId;

	// Fetch initial data in parallel
	const [schedulesResult, filterOptionsResult, payrollConfigsResult] = await Promise.all([
		getScheduledExportsAction(organizationId),
		getFilterOptionsAction(organizationId),
		getPayrollConfigsAction(organizationId),
	]);

	const schedules = schedulesResult.success ? schedulesResult.data : [];
	const filterOptions = filterOptionsResult.success ? filterOptionsResult.data : null;
	const payrollConfigs = payrollConfigsResult.success ? payrollConfigsResult.data : [];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<ScheduledExportsTable
				organizationId={organizationId}
				initialSchedules={schedules}
				initialFilterOptions={filterOptions}
				initialPayrollConfigs={payrollConfigs}
			/>
		</div>
	);
}

function ScheduledExportsLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-72" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function ScheduledExportsPage() {
	return (
		<Suspense fallback={<ScheduledExportsLoading />}>
			<ScheduledExportsContent />
		</Suspense>
	);
}
