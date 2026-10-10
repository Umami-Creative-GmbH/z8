import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { renderExportSettingsSections } from "../export-settings-sections";

// The export-ready email links here (#1022): a path survives the sign-in
// redirect, which keeps only the path of the requested page.
async function ExportHistorySettingsContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return renderExportSettingsSections({ organizationId, initialTab: "history" });
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
