import { Suspense } from "react";
import { CustomRolesManagement } from "@/components/settings/custom-roles/custom-roles-management";
import { TeamPermissionsTab } from "@/components/settings/custom-roles/team-permissions-tab";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

async function CustomRolesSettingsPageContent() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.roles.title", "Custom Roles")}
			defaultTab="roles"
			tabs={[
				{
					value: "roles",
					label: t("settings.roles.title", "Custom Roles"),
					description: t(
						"settings.roles.introduction",
						"Create custom permission roles that can be assigned to employees. Custom roles add permissions on top of the base tier.",
					),
					panel: <CustomRolesManagement organizationId={organizationId} />,
				},
				{
					value: "team-permissions",
					label: t("settings.permissions.title", "Team Permissions"),
					description: t(
						"settings.permissions.description",
						"Manage employee permissions for team operations",
					),
					panel: <TeamPermissionsTab organizationId={organizationId} />,
				},
			]}
		/>
	);
}

function CustomRolesSettingsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.customRoleSettings",
				labelDefault: "Loading custom role settings",
			}}
		>
			{/* Mirrors SettingsTabbedPage: heading and description, tabs, then the table panel. */}
			<div className="space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-48" aria-hidden="true" />
					<Skeleton className="h-5 w-full max-w-xl" aria-hidden="true" />
				</div>
				<Skeleton className="h-9 w-64 max-w-full" aria-hidden="true" />
				<Skeleton className="h-64 w-full" aria-hidden="true" />
			</div>
		</LoadingRegion>
	);
}

export default function CustomRolesSettingsPage() {
	return (
		<Suspense fallback={<CustomRolesSettingsPageLoading />}>
			<CustomRolesSettingsPageContent />
		</Suspense>
	);
}
