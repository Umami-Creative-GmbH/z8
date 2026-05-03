import { connection } from "next/server";
import { Suspense } from "react";
import { LegalEntitySelector } from "@/components/settings/legal-entities/legal-entity-selector";
import { ScheduledExportsTable } from "@/components/settings/scheduled-exports/scheduled-exports-table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getLegalEntitySelectionContext } from "@/lib/legal-entities/access";
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

type LegalEntitySearchParams = {
	legalEntityId?: string;
};

async function ScheduledExportsContent({
	searchParams,
}: {
	searchParams?: Promise<LegalEntitySearchParams>;
}) {
	await connection(); // Mark as fully dynamic

	const [, { organizationId }, resolvedSearchParams] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
		searchParams ?? Promise.resolve({} as LegalEntitySearchParams),
	]);
	const { entities, selectedLegalEntityId } = await getLegalEntitySelectionContext({
		organizationId,
		requestedLegalEntityId: resolvedSearchParams.legalEntityId ?? null,
		isOrgAdmin: true,
		allowedLegalEntityIds: [],
	});

	// Fetch initial data in parallel
	const [schedulesResult, filterOptionsResult, payrollConfigsResult] = await Promise.all([
		getScheduledExportsAction(organizationId, selectedLegalEntityId),
		getFilterOptionsAction(organizationId),
		getPayrollConfigsAction(organizationId, selectedLegalEntityId),
	]);

	const schedules = schedulesResult.success ? schedulesResult.data : [];
	const filterOptions = filterOptionsResult.success ? filterOptionsResult.data : null;
	const payrollConfigs = payrollConfigsResult.success ? payrollConfigsResult.data : [];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<LegalEntitySelector entities={entities} selectedLegalEntityId={selectedLegalEntityId} />
			<ScheduledExportsTable
				organizationId={organizationId}
				legalEntityId={selectedLegalEntityId}
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

export default function ScheduledExportsPage({
	searchParams,
}: {
	searchParams?: Promise<LegalEntitySearchParams>;
}) {
	return (
		<Suspense fallback={<ScheduledExportsLoading />}>
			<ScheduledExportsContent searchParams={searchParams} />
		</Suspense>
	);
}
