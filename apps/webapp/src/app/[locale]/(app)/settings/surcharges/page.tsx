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
		<div
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			aria-label="Loading surcharge settings"
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
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
