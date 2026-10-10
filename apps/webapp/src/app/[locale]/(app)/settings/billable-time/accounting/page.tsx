import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
import { requireBillableTimeSettingsAccess } from "@/lib/billable-time/settings-access";
import { BillableTimeSettingsShell } from "../billable-time-settings-shell";
import { AccountingSettingsView } from "./accounting-settings-view";

async function AccountingSettingsPageContent() {
	await requireBillableTimeSettingsAccess();

	return (
		<BillableTimeSettingsShell activePageId="accounting">
			<AccountingSettingsView />
		</BillableTimeSettingsShell>
	);
}

/** Billable Time → Accounting (#903): the accounting connection, contact links and tax treatment. */
export default function AccountingSettingsPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<AccountingSettingsPageContent />
		</Suspense>
	);
}
