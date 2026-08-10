import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SurchargeManagement } from "@/components/settings/surcharge-management";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function SurchargeSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		redirect("/settings");
	}

	return (
		<SurchargeManagement
			organizationId={organizationId}
			canManage={accessTier === "orgAdmin"}
		/>
	);
}

function SurchargeSettingsPageLoading() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function SurchargeSettingsPage() {
	return (
		<Suspense fallback={<SurchargeSettingsPageLoading />}>
			<SurchargeSettingsPageContent />
		</Suspense>
	);
}
