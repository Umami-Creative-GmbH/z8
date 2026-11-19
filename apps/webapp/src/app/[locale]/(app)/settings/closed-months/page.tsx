import { IconAlertTriangle } from "@tabler/icons-react";
import { Suspense } from "react";
import { ClosedMonthsSettings } from "@/components/settings/closed-months/closed-months-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { getTranslate } from "@/tolgee/server";
import { getClosedMonthsOverview } from "./actions";

/**
 * Closed months (#762). Open to anyone allowed to close or reopen months, which
 * custom roles may grant beyond owners and admins; the actions check it.
 */
async function ClosedMonthsSettingsPageContent() {
	const [t, overview] = await Promise.all([getTranslate(), getClosedMonthsOverview()]);

	return (
		<div className="page-frame">
			<div className="min-w-0 space-y-6">
				<PageHeader
					title={t("settings.closedMonths.title", "Closed months")}
					description={t(
						"settings.closedMonths.description",
						"Close months after payroll so their work and absences can no longer change",
					)}
				/>
				{overview.success ? (
					<ClosedMonthsSettings overview={overview.data} />
				) : (
					<Alert variant="destructive">
						<IconAlertTriangle aria-hidden="true" />
						<AlertTitle>
							{t("settings.closedMonths.loadErrorTitle", "Closed months could not be loaded")}
						</AlertTitle>
						<AlertDescription>
							{actionErrorMessage(t, overview, {}, [
								"settings.closedMonths.loadErrorDescription",
								"Reload the page to try again.",
							])}
						</AlertDescription>
					</Alert>
				)}
			</div>
		</div>
	);
}

function ClosedMonthsSettingsPageLoading() {
	return (
		<div className="page-frame" aria-busy="true">
			<div className="min-w-0 space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" aria-hidden="true" />
					<Skeleton className="h-5 w-full max-w-xl" aria-hidden="true" />
				</div>
				<Skeleton className="h-96 w-full" aria-hidden="true" />
			</div>
		</div>
	);
}

export default function ClosedMonthsSettingsPage() {
	return (
		<Suspense fallback={<ClosedMonthsSettingsPageLoading />}>
			<ClosedMonthsSettingsPageContent />
		</Suspense>
	);
}
