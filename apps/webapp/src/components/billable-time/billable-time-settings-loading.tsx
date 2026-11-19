import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Billable Time settings shell: heading, page navigation, then the page's main block. */
export function BillableTimeSettingsLoading() {
	return (
		<LoadingRegion
			className="page-frame"
			label={{
				labelKey: "common.loadingRegions.billableTimeSettings",
				labelDefault: "Loading billable time settings",
			}}
		>
			<div className="page-measure space-y-6" aria-hidden="true">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-9 w-full max-w-lg" />
				<Skeleton className="h-64 w-full" />
			</div>
		</LoadingRegion>
	);
}
