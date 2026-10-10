import { Suspense } from "react";
import { KioskSettings } from "@/components/settings/kiosks/kiosk-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getKioskAdminDataAction } from "./actions";

async function KioskSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	const [t, result] = await Promise.all([getTranslate(), getKioskAdminDataAction()]);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-5xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.kiosks.title", "Kiosks")}</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.kiosks.description",
							"Shared devices at a location where employees clock with their kiosk PIN",
						)}
					</p>
				</div>
				{result.success ? (
					<KioskSettings data={result.data} />
				) : (
					<p className="text-sm text-muted-foreground">
						{t("settings.kiosks.loadFailed", "Kiosks could not be loaded.")}
					</p>
				)}
			</div>
		</div>
	);
}

function KioskSettingsPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-5xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-40" />
					<Skeleton className="h-5 w-full max-w-xl" />
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
