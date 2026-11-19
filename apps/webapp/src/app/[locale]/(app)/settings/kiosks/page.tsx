import { Suspense } from "react";
import { KioskSettings } from "@/components/settings/kiosks/kiosk-settings";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getKioskAdminDataAction } from "./actions";

async function KioskSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	const [t, result] = await Promise.all([getTranslate(), getKioskAdminDataAction()]);

	return (
		<div className="page-frame">
			{result.success ? (
				// The page heading lives in KioskSettings so "Add kiosk" can sit in its actions.
				<KioskSettings data={result.data} />
			) : (
				<div className="min-w-0 space-y-6">
					<PageHeader
						title={t("settings.kiosks.title", "Kiosks")}
						description={t(
							"settings.kiosks.description",
							"Shared devices at a location where employees clock with their kiosk PIN",
						)}
					/>
					<SettingsLoadError
						message={t("settings.kiosks.loadFailed", "Kiosks could not be loaded.")}
					/>
				</div>
			)}
		</div>
	);
}

function KioskSettingsPageLoading() {
	return (
		<div className="page-frame" aria-busy="true">
			<div className="min-w-0 space-y-6">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div className="space-y-2">
						<Skeleton className="h-8 w-40" />
						<Skeleton className="h-5 w-96 max-w-full" />
					</div>
					<Skeleton className="h-9 w-28" />
				</div>
				<Skeleton className="h-72 w-full" />
			</div>
		</div>
	);
}

export default function KioskSettingsPage() {
	return (
		<Suspense fallback={<KioskSettingsPageLoading />}>
			<KioskSettingsPageContent />
		</Suspense>
	);
}
