import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { renderExportSettingsView } from "./export-settings-view";

async function ExportSettingsContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return renderExportSettingsView({ organizationId });
}

function ExportSettingsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.dataExportSettings",
				labelDefault: "Loading data export settings",
			}}
		/>
	);
}

export default function ExportSettingsPage() {
	return (
		<Suspense fallback={<ExportSettingsLoading />}>
			<ExportSettingsContent />
		</Suspense>
	);
}
