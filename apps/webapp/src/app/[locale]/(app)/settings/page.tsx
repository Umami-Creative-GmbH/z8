import { getVisibleGroups, getVisibleSettings } from "@/components/settings/settings-config";
import { SettingsGrid } from "@/components/settings/settings-grid";
import { canManageCurrentOrganizationSettings, requireUser } from "@/lib/auth-helpers";

export default async function SettingsPage() {
	await requireUser();
	const canManageOrgSettings = await canManageCurrentOrganizationSettings();

	const visibleSettings = getVisibleSettings(canManageOrgSettings);
	const visibleGroups = getVisibleGroups(canManageOrgSettings);

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />
			</div>
		</div>
	);
}
