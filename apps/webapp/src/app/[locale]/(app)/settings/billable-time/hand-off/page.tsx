import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
import { requireBillableTimeSettingsAccess } from "@/lib/billable-time/settings-access";
import { BillableTimeSettingsShell } from "../billable-time-settings-shell";
import { HandOffView } from "./hand-off-view";

async function HandOffPageContent() {
	await requireBillableTimeSettingsAccess();

	return (
		<BillableTimeSettingsShell activePageId="hand-off">
			<HandOffView />
		</BillableTimeSettingsShell>
	);
}

/** Billable Time → Hand-off (#903): invoice drafts from billable work, release and marks. */
export default function HandOffPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<HandOffPageContent />
		</Suspense>
	);
}
