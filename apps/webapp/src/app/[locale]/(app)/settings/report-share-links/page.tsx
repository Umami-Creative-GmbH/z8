import { ReportShareLinkList } from "@/components/reports/projects/report-share-link-list";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

/** Every report share link of the organization, for owners and admins to find and revoke (#806). */
export default async function ReportShareLinksPage() {
	const [, t] = await Promise.all([requireOrgAdminSettingsAccess(), getTranslate()]);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-4xl space-y-6">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold">
						{t("settings.reportShareLinks.title", "Report Share Links")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.reportShareLinks.pageDescription",
							"Links that show a frozen snapshot of a project or customer report to someone outside Z8. Revoking a link stops it at once and deletes its snapshot.",
						)}
					</p>
				</div>
				<ReportShareLinkList showReport />
			</div>
		</div>
	);
}
