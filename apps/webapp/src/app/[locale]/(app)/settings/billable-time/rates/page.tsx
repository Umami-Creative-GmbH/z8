import { Suspense } from "react";
import { BillableTimeSettingsLoading } from "@/components/billable-time/billable-time-settings-loading";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function BillableRatesPageContent() {
	return redirectWithLocale("/settings/billable-time");
}

/** Legacy `/settings/billable-time/rates` route redirects to `/settings/billable-time` (#1956). */
export default function BillableRatesPage() {
	return (
		<Suspense fallback={<BillableTimeSettingsLoading />}>
			<BillableRatesPageContent />
		</Suspense>
	);
}
