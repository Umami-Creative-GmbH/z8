import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess, requireUser } from "@/lib/auth-helpers";
import { resolveExportHistoryArrival } from "@/lib/export/history-arrival";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { renderExportSettingsView } from "../../export-settings-view";
import { ExportHistorySwitchOrganizationCard } from "./switch-organization-card";

interface OrganizationExportHistoryPageProps {
	params: Promise<{ organizationId: string }>;
}

// The export-ready email links here with the export's organization in the
// path (#1039), so a multi-org admin never sees the wrong organization's
// history and the link still survives the sign-in redirect.
async function OrganizationExportHistoryContent({ params }: OrganizationExportHistoryPageProps) {
	const [{ organizationId }, authContext] = await Promise.all([params, requireUser()]);
	const arrival = await resolveExportHistoryArrival({
		userId: authContext.user.id,
		activeOrganizationId: authContext.session.activeOrganizationId,
		organizationId,
	});

	if (arrival.status === "switch_organization") {
		return (
			<ExportHistorySwitchOrganizationCard
				organizationId={arrival.organizationId}
				organizationName={arrival.organizationName}
			/>
		);
	}
	if (arrival.status === "unavailable") {
		return redirectWithLocale("/settings");
	}

	const access = await requireOrgAdminSettingsAccess();
	if (access.organizationId !== organizationId) {
		return redirectWithLocale("/settings");
	}

	return renderExportSettingsView({ organizationId, initialTab: "history" });
}

function OrganizationExportHistoryLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.dataExportSettings",
				labelDefault: "Loading data export settings",
			}}
		/>
	);
}

export default function OrganizationExportHistoryPage({
	params,
}: OrganizationExportHistoryPageProps) {
	return (
		<Suspense fallback={<OrganizationExportHistoryLoading />}>
			<OrganizationExportHistoryContent params={params} />
		</Suspense>
	);
}
