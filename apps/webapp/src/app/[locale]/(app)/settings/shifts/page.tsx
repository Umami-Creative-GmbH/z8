import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ShiftTemplateManagement } from "@/components/settings/shift-template-management";
import {
	getSchedulingSettingsAccessContext,
	getScopedSchedulingLocationsForSettings,
} from "@/lib/settings-scheduling-access";

export default async function ShiftTemplatesPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const accessContext = await getSchedulingSettingsAccessContext();

	if (!accessContext || !accessContext.canAccessShiftTemplates) {
		redirect("/settings");
	}

	const locations = await getScopedSchedulingLocationsForSettings({
		organizationId: accessContext.organizationId,
		manageableSubareaIds: accessContext.manageableShiftTemplateSubareaIds,
	});

	return (
		<ShiftTemplateManagement
			organizationId={accessContext.organizationId}
			locations={locations}
			manageableSubareaIds={
				accessContext.manageableShiftTemplateSubareaIds
					? [...accessContext.manageableShiftTemplateSubareaIds]
					: null
			}
		/>
	);
}
