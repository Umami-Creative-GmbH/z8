import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function PayrollReadinessRedirect() {
	return redirectWithLocale("/payroll");
}

function PayrollReadinessLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.payrollReadiness",
				labelDefault: "Loading payroll readiness",
			}}
		/>
	);
}

/** Legacy `/settings/payroll-readiness` route redirects to `/payroll` (#1957). */
export default function PayrollReadinessPage() {
	return (
		<Suspense fallback={<PayrollReadinessLoading />}>
			<PayrollReadinessRedirect />
		</Suspense>
	);
}
