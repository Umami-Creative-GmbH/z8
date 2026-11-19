import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExpiryReminderSettingsCard } from "@/components/personnel-file/expiry-reminder-settings";
import { PersonnelFileOfficerSettingsCard } from "@/components/personnel-file/officer-grant-settings";
import { PersonnelFileSettingsTabs } from "@/components/personnel-file/personnel-file-settings-tabs";
import { PersonnelFileRetentionSettingsCard } from "@/components/personnel-file/retention-settings";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { isPersonnelFilesEnabled } from "@/lib/personnel-file/access-store";
import { loadExpiryReminderLeadDays } from "@/lib/personnel-file/expiry-store";
import { getTranslate } from "@/tolgee/server";

/**
 * Settings → Personnel files (#866): for owners and admins while personnel
 * files are on. The Access tab manages personnel file officer grants; the
 * Reminders tab the expiry reminder lead time (#869).
 */
async function PersonnelFileSettingsPageContent() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);
	if (!(await isPersonnelFilesEnabled(db, organizationId))) notFound();
	const leadDays = await loadExpiryReminderLeadDays(db, organizationId);

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.personnelFiles.settings.title", "Personnel Files")}
					description={t(
						"settings.personnelFiles.settings.description",
						"Choose who besides owners and admins manages employee documents.",
					)}
				/>
				<PersonnelFileSettingsTabs
					access={<PersonnelFileOfficerSettingsCard />}
					reminders={<ExpiryReminderSettingsCard leadDays={leadDays} />}
					retention={<PersonnelFileRetentionSettingsCard />}
				/>
			</div>
		</div>
	);
}

function PersonnelFileSettingsPageLoading() {
	return (
		<div className="page-frame">
			<LoadingRegion
				className="page-measure space-y-6"
				role="status"
				label={{
					labelKey: "settings.personnelFiles.settings.loading",
					labelDefault: "Loading personnel file settings",
				}}
			>
				<div className="space-y-2">
					<Skeleton className="h-8 w-48" aria-hidden="true" />
					<Skeleton className="h-5 w-full max-w-xl" aria-hidden="true" />
				</div>
				<Skeleton className="h-9 w-64" aria-hidden="true" />
				<Skeleton className="h-64 w-full" aria-hidden="true" />
			</LoadingRegion>
		</div>
	);
}

export default function PersonnelFileSettingsPage() {
	return (
		<Suspense fallback={<PersonnelFileSettingsPageLoading />}>
			<PersonnelFileSettingsPageContent />
		</Suspense>
	);
}
