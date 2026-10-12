import { Suspense } from "react";
import { ClosedMonthsSettings } from "@/components/settings/closed-months/closed-months-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslate } from "@/tolgee/server";
import { getClosedMonthsOverview } from "./actions";

/**
 * Closed months (#762). Open to anyone allowed to close or reopen months, which
 * custom roles may grant beyond owners and admins; the actions check it.
 */
async function ClosedMonthsSettingsPageContent() {
	const [t, overview] = await Promise.all([getTranslate(), getClosedMonthsOverview()]);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.closedMonths.title", "Closed months")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.closedMonths.description",
							"Close months after payroll so their work and absences can no longer change",
						)}
					</p>
				</div>
				{overview.success ? (
					<ClosedMonthsSettings overview={overview.data} />
				) : (
					<p role="alert" className="text-destructive text-sm">
						{overview.error}
					</p>
				)}
			</div>
		</div>
	);
}

function ClosedMonthsSettingsPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-96 w-full" />
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
