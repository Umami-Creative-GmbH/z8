import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { isBillableCurrencyLocked } from "@/lib/billable-time/currency-lock";
import { requireBillableTimeSettingsAccess } from "@/lib/billable-time/settings-access";
import { BillableCurrencyCard } from "./billable-currency-card";
import { BillableTimeSettingsShell } from "./billable-time-settings-shell";

async function BillableTimeSettingsPageContent() {
	const { organizationId, settings } = await requireBillableTimeSettingsAccess();
	const locked = await isBillableCurrencyLocked(db, organizationId);

	return (
		<BillableTimeSettingsShell activePageId="currency">
			<BillableCurrencyCard currency={settings.currency} locked={locked} />
		</BillableTimeSettingsShell>
	);
}

function BillableTimeSettingsPageLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-48 w-full" />
			</div>
		</div>
	);
}

export default function BillableTimeSettingsPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsPageLoading />}>
			<BillableTimeSettingsPageContent />
		</Suspense>
	);
}
