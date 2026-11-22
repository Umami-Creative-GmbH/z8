import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { SurchargeManagement } from "@/components/settings/surcharge-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function SurchargeSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		return redirectWithLocale("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		return redirectWithLocale("/settings");
	}

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});

	return (
		<SurchargeManagement
			organizationId={organizationId}
			canManage={accessTier === "orgAdmin"}
			organizationTimezone={org?.timezone || "UTC"}
		/>
	);
}

function SurchargeSettingsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.surchargeSettings",
				labelDefault: "Loading surcharge settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function SurchargeSettingsPage() {
	return (
		<Suspense fallback={<SurchargeSettingsPageLoading />}>
			<SurchargeSettingsPageContent />
		</Suspense>
	);
}
