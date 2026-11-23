import { Suspense } from "react";
import { NeutralPageLoading } from "@/components/shells/neutral-page-loading";
import { ComplianceExceptionsRedirect } from "./compliance-exceptions-redirect";

/**
 * Retired compliance exception queue: redirects to the Approval inbox's compliance exceptions
 * (#1977). `/settings/compliance/works-council` is its own page and stays untouched.
 */
export default function ComplianceSettingsPage() {
	return (
		<Suspense fallback={<NeutralPageLoading />}>
			<ComplianceExceptionsRedirect />
		</Suspense>
	);
}
