import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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

function AccountingSettingsPageLoading() {
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

/** Billable Time → Accounting (#903): the accounting connection, contact links and tax treatment. */
export default function AccountingSettingsPage() {
	return (
		<Suspense fallback={<AccountingSettingsPageLoading />}>
			<AccountingSettingsPageContent />
		</Suspense>
	);
}
