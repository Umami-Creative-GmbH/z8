import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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

function HandOffPageLoading() {
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

/** Billable Time → Hand-off (#903): invoice drafts from billable work, release and marks. */
export default function HandOffPage() {
	return (
		<Suspense fallback={<HandOffPageLoading />}>
			<HandOffPageContent />
		</Suspense>
	);
}
