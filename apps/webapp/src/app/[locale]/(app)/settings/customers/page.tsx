import { Suspense } from "react";
import { CustomerManagement } from "@/components/settings/customer-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

async function CustomerSettingsPageContent() {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	return (
		<CustomerManagement
			organizationId={caller.organizationId}
			settingsAccess={caller.settingsAccess}
		/>
	);
}

function CustomerSettingsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.customerSettings",
				labelDefault: "Loading customer settings",
			}}
		>
			<div className="space-y-2 pb-2">
				<Skeleton className="h-8 w-48" aria-hidden="true" />
				<Skeleton className="h-4 w-full max-w-md" aria-hidden="true" />
			</div>
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function CustomerSettingsPage() {
	return (
		<Suspense fallback={<CustomerSettingsPageLoading />}>
			<CustomerSettingsPageContent />
		</Suspense>
	);
}
