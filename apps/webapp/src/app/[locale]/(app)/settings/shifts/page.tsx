import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ShiftTemplateManagement } from "@/components/settings/shift-template-management";
import { Skeleton } from "@/components/ui/skeleton";
import {
	getSchedulingSettingsAccessContext,
	getScopedSchedulingLocationsForSettings,
} from "@/lib/settings-scheduling-access";

async function ShiftTemplatesPageContent() {
	const accessContext = await getSchedulingSettingsAccessContext();

	if (!accessContext?.canAccessShiftTemplates) {
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

function ShiftTemplatesPageLoading() {
	return (
		<div
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			aria-label="Loading shift template settings"
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</div>
	);
}

export default function ShiftTemplatesPage() {
	return (
		<Suspense fallback={<ShiftTemplatesPageLoading />}>
			<ShiftTemplatesPageContent />
		</Suspense>
	);
}
