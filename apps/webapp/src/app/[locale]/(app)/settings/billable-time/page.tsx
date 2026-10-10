import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
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

export default function BillableTimeSettingsPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<BillableTimeSettingsPageContent />
		</Suspense>
	);
}
