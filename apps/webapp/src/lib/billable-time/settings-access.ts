import "server-only";

import { db } from "@/db";
import { type AuthContext, requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { type BillableTimeSettings, getBillableTimeSettings } from "./settings";

export interface BillableTimeSettingsAccess {
	authContext: AuthContext;
	/** The active organization. Every read and write on the page is scoped to it. */
	organizationId: string;
	settings: BillableTimeSettings & {
		enabled: true;
		currency: NonNullable<BillableTimeSettings["currency"]>;
	};
}

/**
 * Gate for every page in the Billable Time settings area (#897): org admins of
 * the active organization, while the module is on. Anyone else is sent back to
 * the settings overview. Server actions still authorize on their own.
 */
export async function requireBillableTimeSettingsAccess(): Promise<BillableTimeSettingsAccess> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const settings = await getBillableTimeSettings(organizationId, db);

	if (!settings.enabled || settings.currency === null) {
		return redirectWithLocale("/settings");
	}

	return {
		authContext,
		organizationId,
		settings: { enabled: true, currency: settings.currency },
	};
}
