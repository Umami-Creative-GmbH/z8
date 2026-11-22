import { IconSettings } from "@tabler/icons-react";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBillableTimeSettingsAccess } from "@/lib/billable-time/settings-access";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { HandOffView } from "../../settings/billable-time/hand-off/hand-off-view";

async function BillableHandOffPageContent() {
	await requireBillableTimeSettingsAccess();
	const t = await getTranslate();

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("nav.billable-hand-off", "Billable Hand-off")}
					description={t(
						"billableTime.handOff.description",
						"Create invoice drafts from billable work, check tool status, download timesheets, and resolve post-invoicing changes.",
					)}
					actions={
						<Button variant="outline" asChild>
							<Link href="/settings/billable-time">
								<IconSettings aria-hidden="true" className="mr-2 size-4" />
								{t("billableTime.handOff.configureSettings", "Billable Time settings")}
							</Link>
						</Button>
					}
				/>
				<HandOffView />
			</div>
		</div>
	);
}

function BillableHandOffLoading() {
	return (
		<LoadingRegion
			className="page-frame"
			label={{
				labelKey: "common.loadingRegions.billableHandOff",
				labelDefault: "Loading billable hand-off",
			}}
		>
			<div className="page-measure space-y-6" aria-hidden="true">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-56 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		</LoadingRegion>
	);
}

/** Top-level Billable Hand-off workspace (#1956): invoice drafts from billable work, release and marks. */
export default function BillableHandOffPage() {
	return (
		<Suspense fallback={<BillableHandOffLoading />}>
			<BillableHandOffPageContent />
		</Suspense>
	);
}
