import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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

function CostRatesPageLoading() {
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

export default function CostRatesPage() {
	return (
		<Suspense fallback={<CostRatesPageLoading />}>
			<CostRatesPageContent />
		</Suspense>
	);
}
