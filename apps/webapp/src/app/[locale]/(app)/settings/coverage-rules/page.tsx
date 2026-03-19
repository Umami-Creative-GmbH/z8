import { connection } from "next/server";
import { redirect } from "next/navigation";
import { CoverageRulesManagement } from "@/components/settings/coverage-rules-management";
import {
	getSchedulingSettingsAccessContext,
	getScopedSchedulingLocationsForSettings,
} from "@/lib/settings-scheduling-access";
import { getTranslate } from "@/tolgee/server";

export default async function CoverageRulesSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	await getTranslate();
	const accessContext = await getSchedulingSettingsAccessContext();

	if (!accessContext || !accessContext.canAccessCoverageRules) {
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
