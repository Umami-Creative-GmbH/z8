import type { Metadata } from "next";
import { Suspense } from "react";
import { ScheduledExportsTable } from "@/components/settings/scheduled-exports/scheduled-exports-table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getFilterOptionsAction,
	getPayrollConfigsAction,
	getScheduledExportsAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslate();

	return {
		title: t("settings.scheduledExports.title", "Scheduled Exports"),
		description: t(
			"settings.scheduledExports.description",
			"Configure recurring exports for payroll, data, and audit reports.",
		),
	};
}

async function ScheduledExportsContent() {
	const { organizationId, authContext } = await requireOrgAdminSettingsAccess();

	// Fetch initial data in parallel after the org access guard.
	// eslint-disable-next-line react-doctor/server-sequential-independent-await
	const [schedulesResult, filterOptionsResult, payrollConfigsResult] =
		await Promise.all([
			getScheduledExportsAction(),
			getFilterOptionsAction(),
			getPayrollConfigsAction(),
		]);

	const schedules = schedulesResult.success ? schedulesResult.data : [];
	const filterOptions = filterOptionsResult.success
		? filterOptionsResult.data
		: null;
	const payrollConfigs = payrollConfigsResult.success
		? payrollConfigsResult.data
		: [];

	return (
		<div className="page-frame flex flex-1 flex-col gap-6">
			<ScheduledExportsTable
				organizationId={organizationId}
				currentUserId={authContext.user.id}
				initialSchedules={schedules}
				initialFilterOptions={filterOptions}
				initialPayrollConfigs={payrollConfigs}
			/>
		</div>
	);
}

function ScheduledExportsLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.scheduledExports",
				labelDefault: "Loading scheduled exports",
			}}
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton aria-hidden="true" className="h-6 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-72" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<Skeleton aria-hidden="true" className="h-10 w-full" />
						<Skeleton aria-hidden="true" className="h-10 w-full" />
						<Skeleton aria-hidden="true" className="h-10 w-full" />
					</div>
				</CardContent>
			</Card>
		</LoadingRegion>
	);
}

export default function ScheduledExportsPage() {
	return (
		<Suspense fallback={<ScheduledExportsLoading />}>
			<ScheduledExportsContent />
		</Suspense>
	);
}
