import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { SurchargeManagement } from "@/components/settings/surcharge-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { requireOrganizationFeatureEnabled } from "@/lib/settings/feature-flags.server";

async function SurchargeSettingsPageContent() {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	await requireOrganizationFeatureEnabled(caller.organizationId, "surchargesEnabled");

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, caller.organizationId),
		columns: { timezone: true },
	});

	return (
		<SurchargeManagement
			organizationId={caller.organizationId}
			canManage={meetsSettingsAccess(caller.settingsAccess, "orgAdmin")}
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
