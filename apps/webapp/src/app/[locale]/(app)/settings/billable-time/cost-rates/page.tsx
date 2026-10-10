import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
import { db } from "@/db";
import { listEmployeeCostRates } from "@/lib/billable-time/cost-rates";
import { requireBillableTimeSettingsAccess } from "@/lib/billable-time/settings-access";
import { BillableTimeSettingsShell } from "../billable-time-settings-shell";
import { CostRatesOverview } from "./cost-rates-overview";

async function CostRatesPageContent() {
	const { organizationId, settings } = await requireBillableTimeSettingsAccess();
	const employees = await listEmployeeCostRates(db, organizationId);

	return (
		<BillableTimeSettingsShell activePageId="cost-rates">
			<CostRatesOverview currency={settings.currency} employees={employees} />
		</BillableTimeSettingsShell>
	);
}

export default function CostRatesPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<CostRatesPageContent />
		</Suspense>
	);
}
