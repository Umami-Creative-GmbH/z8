import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PersonnelFileOfficerSettingsCard } from "@/components/personnel-file/officer-grant-settings";
import { PersonnelFileSettingsTabs } from "@/components/personnel-file/personnel-file-settings-tabs";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { isPersonnelFilesEnabled } from "@/lib/personnel-file/access-store";
import { getTranslate } from "@/tolgee/server";

/**
 * Settings → Personnel files (#866): for owners and admins while personnel
 * files are on. The Access tab manages personnel file officer grants.
 */
async function PersonnelFileSettingsPageContent() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);
	if (!(await isPersonnelFilesEnabled(db, organizationId))) notFound();

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.personnelFiles.settings.title", "Personnel Files")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.settings.description",
						"Choose who besides owners and admins manages employee documents.",
					)}
				</p>
			</div>
			<PersonnelFileSettingsTabs access={<PersonnelFileOfficerSettingsCard />} />
		</div>
	);
}

function PersonnelFileSettingsPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "settings.personnelFiles.settings.loading",
				labelDefault: "Loading personnel file settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function PersonnelFileSettingsPage() {
	return (
		<Suspense fallback={<PersonnelFileSettingsPageLoading />}>
			<PersonnelFileSettingsPageContent />
		</Suspense>
	);
}
