import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
import { db } from "@/db";
import {
	listBillableRateSeries,
	listBillableRateTargetOptions,
} from "@/lib/billable-time/billable-rates";
import { isBillableCurrencyLocked } from "@/lib/billable-time/currency-lock";
import { requireBillableTimeSettingsAccess } from "@/lib/billable-time/settings-access";
import { BillableCurrencyCard } from "./billable-currency-card";
import { BillableTimeSettingsShell } from "./billable-time-settings-shell";
import { AddBillableRateAction, BillableRatesOverview } from "./rates/billable-rates-overview";

async function BillableTimeSettingsPageContent() {
	const { organizationId, settings } = await requireBillableTimeSettingsAccess();
	const [locked, series, options] = await Promise.all([
		isBillableCurrencyLocked(db, organizationId),
		listBillableRateSeries(db, organizationId),
		listBillableRateTargetOptions(db, organizationId),
	]);

	return (
		<BillableTimeSettingsShell
			activePageId="rates"
			actions={<AddBillableRateAction options={options} />}
		>
			<div className="space-y-6">
				<BillableCurrencyCard currency={settings.currency} locked={locked} />
				<BillableRatesOverview currency={settings.currency} series={series} />
			</div>
		</BillableTimeSettingsShell>
	);
}

export default function BillableTimeSettingsPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<BillableTimeSettingsPageContent />
		</Suspense>
	);
}
