import { Suspense } from "react";
import { ImportHub } from "@/components/settings/import/import-hub";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

async function ImportPageContent() {
	// Org-admin access is enforced here (it redirects otherwise); the import actions re-check it.
	const [, t] = await Promise.all([requireOrgAdminSettingsAccess(), getTranslate()]);

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.import.title", "Import Data")}
					description={t(
						"settings.import.supportedSources",
						"Import work from CSV files or connect supported providers such as Clockodo and Clockin.",
					)}
				/>

				<ImportHub />
			</div>
		</div>
	);
}

function ImportPageLoading() {
	return (
		<LoadingRegion
			className="page-frame"
			role="status"
			label={{
				labelKey: "common.loadingRegions.importSettings",
				labelDefault: "Loading import settings",
			}}
		>
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
				</div>
				<Skeleton aria-hidden="true" className="h-10 w-64" />
				<Skeleton aria-hidden="true" className="h-64 w-full" />
			</div>
		</LoadingRegion>
	);
}

export default function ImportPage() {
	return (
		<Suspense fallback={<ImportPageLoading />}>
			<ImportPageContent />
		</Suspense>
	);
}
