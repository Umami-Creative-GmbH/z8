import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import {
	listBillableRateSeries,
	listBillableRateTargetOptions,
} from "@/lib/billable-time/billable-rates";
import { requireBillableTimeSettingsAccess } from "@/lib/billable-time/settings-access";
import { BillableTimeSettingsShell } from "../billable-time-settings-shell";
import { BillableRatesOverview } from "./billable-rates-overview";

async function BillableRatesPageContent() {
	const { organizationId, settings } = await requireBillableTimeSettingsAccess();
	const [series, options] = await Promise.all([
		listBillableRateSeries(db, organizationId),
		listBillableRateTargetOptions(db, organizationId),
	]);

	return (
		<BillableTimeSettingsShell activePageId="rates">
			<BillableRatesOverview currency={settings.currency} series={series} options={options} />
		</BillableTimeSettingsShell>
	);
}

function BillableRatesPageLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function BillableRatesPage() {
	return (
		<Suspense fallback={<BillableRatesPageLoading />}>
			<BillableRatesPageContent />
		</Suspense>
	);
}
