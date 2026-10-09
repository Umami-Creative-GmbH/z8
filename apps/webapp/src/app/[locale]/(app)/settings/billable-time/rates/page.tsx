import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
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

export default function BillableRatesPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<BillableRatesPageContent />
		</Suspense>
	);
}
