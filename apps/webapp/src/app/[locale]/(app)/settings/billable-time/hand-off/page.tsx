import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function HandOffPageContent() {
	return redirectWithLocale("/billable-time/hand-off");
}

/** Legacy `/settings/billable-time/hand-off` route redirects to `/billable-time/hand-off` (#1956). */
export default function HandOffPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<HandOffPageContent />
		</Suspense>
	);
}
