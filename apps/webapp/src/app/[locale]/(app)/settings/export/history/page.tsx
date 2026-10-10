import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { renderExportSettingsView } from "../export-settings-view";

// Opens the active organization's export history. The export-ready email
// links to the organization-scoped route in ./[organizationId] instead.
async function ExportHistorySettingsContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return renderExportSettingsView({ organizationId, initialTab: "history" });
}

function ExportHistorySettingsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.dataExportSettings",
				labelDefault: "Loading data export settings",
			}}
		/>
	);
}

export default function ExportHistorySettingsPage() {
	return (
		<Suspense fallback={<ExportHistorySettingsLoading />}>
			<ExportHistorySettingsContent />
		</Suspense>
	);
}
