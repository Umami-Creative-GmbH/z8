import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ShiftTemplateManagement } from "@/components/settings/shift-template-management";
import { LoadingRegion } from "@/components/ui/loading-region";
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
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.shiftTemplateSettings",
				labelDefault: "Loading shift template settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function ShiftTemplatesPage() {
	return (
		<Suspense fallback={<ShiftTemplatesPageLoading />}>
			<ShiftTemplatesPageContent />
		</Suspense>
	);
}
