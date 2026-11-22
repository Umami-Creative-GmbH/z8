import { IconInfoCircle } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { isOrganizationFeatureEnabled } from "@/lib/settings/feature-flags.server";
import { getTranslate } from "@/tolgee/server";
import { ReportShareLinksList } from "./report-share-links-list";

/** Every report share link of the organization, for owners and admins to find and revoke (#806). */
export default async function ReportShareLinksPage() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);
	const projectsEnabled = await isOrganizationFeatureEnabled(organizationId, "projectsEnabled");

	return (
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
				<PageHeader
					title={t("settings.reportShareLinks.title", "Report Share Links")}
					description={t(
						"settings.reportShareLinks.pageDescription",
						"Links that show a frozen snapshot of a project or customer report to someone outside Z8. Revoking a link stops it at once and deletes its snapshot.",
					)}
				/>
				{!projectsEnabled && (
					<Alert>
						<IconInfoCircle aria-hidden="true" />
						<AlertTitle>
							{t(
								"settings.reportShareLinks.projectsDisabledNotice.title",
								"Projects is turned off",
							)}
						</AlertTitle>
						<AlertDescription>
							{t(
								"settings.reportShareLinks.projectsDisabledNotice.description",
								"Projects is currently turned off for this organization, so no new report share links can be created. You can still review and revoke existing links here.",
							)}
						</AlertDescription>
					</Alert>
				)}
				<ReportShareLinksList />
			</div>
		</div>
	);
}
