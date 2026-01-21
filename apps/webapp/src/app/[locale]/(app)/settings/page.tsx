import { getVisibleGroups, getVisibleSettings } from "@/components/settings/settings-config";
import { SettingsGrid } from "@/components/settings/settings-grid";
import { requireUser } from "@/lib/auth-helpers";

export default async function SettingsPage() {
	const authContext = await requireUser();
	const isAdmin = authContext.employee?.role === "admin";

	const visibleSettings = getVisibleSettings(isAdmin);
	const visibleGroups = getVisibleGroups(isAdmin);

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />
			</div>
		</div>
	);
}
