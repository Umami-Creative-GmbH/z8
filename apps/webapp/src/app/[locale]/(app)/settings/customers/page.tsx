import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CustomerManagement } from "@/components/settings/customer-management";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function CustomerSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return (
		<CustomerManagement
			organizationId={organizationId}
			accessTier={settingsRouteContext.accessTier}
		/>
	);
}

function CustomerSettingsPageLoading() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function CustomerSettingsPage() {
	return (
		<Suspense fallback={<CustomerSettingsPageLoading />}>
			<CustomerSettingsPageContent />
		</Suspense>
	);
}
