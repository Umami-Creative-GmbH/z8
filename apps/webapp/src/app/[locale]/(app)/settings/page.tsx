import { eq } from "drizzle-orm";
import {
	getResolvedSettingsVisibility,
} from "@/components/settings/settings-config";
import { SettingsGrid } from "@/components/settings/settings-grid";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { getCurrentSettingsRouteContext, requireUser } from "@/lib/auth-helpers";

export default async function SettingsPage() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		await requireUser();
	}

	const { authContext, accessTier } = settingsRouteContext!;
	const billingEnabled = process.env.BILLING_ENABLED === "true";
	const activeOrganizationId =
		authContext.session.activeOrganizationId ?? authContext.employee?.organizationId ?? null;

	const currentOrganization = activeOrganizationId
		? await db.query.organization.findFirst({
				columns: {
					shiftsEnabled: true,
					projectsEnabled: true,
					surchargesEnabled: true,
				},
				where: eq(authSchema.organization.id, activeOrganizationId),
			})
		: null;
	const featureFlags = currentOrganization
		? {
				shiftsEnabled: currentOrganization.shiftsEnabled ?? false,
				projectsEnabled: currentOrganization.projectsEnabled ?? false,
				surchargesEnabled: currentOrganization.surchargesEnabled ?? false,
			}
		: undefined;

	const { visibleSettings, visibleGroups } = getResolvedSettingsVisibility({
		accessTier,
		billingEnabled,
		featureFlags,
	});

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />
			</div>
		</div>
	);
}
