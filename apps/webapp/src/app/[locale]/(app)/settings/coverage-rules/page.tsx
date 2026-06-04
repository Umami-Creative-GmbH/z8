import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CoverageRulesManagement } from "@/components/settings/coverage-rules-management";
import {
	getSchedulingSettingsAccessContext,
	getScopedSchedulingLocationsForSettings,
} from "@/lib/settings-scheduling-access";
import { getTranslate } from "@/tolgee/server";

export default async function CoverageRulesSettingsPage() {
	const [, , accessContext] = await Promise.all([
		connection(), // Mark as fully dynamic for cacheComponents mode
		getTranslate(),
		getSchedulingSettingsAccessContext(),
	]);

	if (!accessContext?.canAccessCoverageRules) {
		redirect("/settings");
	}

	const locations = await getScopedSchedulingLocationsForSettings({
		organizationId: accessContext.organizationId,
		manageableSubareaIds: accessContext.manageableSubareaIds,
	});

	return (
		<CoverageRulesManagement
			organizationId={accessContext.organizationId}
			locations={locations}
			manageableSubareaIds={
				accessContext.manageableSubareaIds ? [...accessContext.manageableSubareaIds] : null
			}
			canManageCoverageSettings={accessContext.canManageCoverageSettings}
		/>
	);
}
