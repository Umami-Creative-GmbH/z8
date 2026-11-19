import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading fallback for the combined Approval settings page. It mirrors the
 * page frame, heading and tab strip of `ApprovalSettingsTabs` so nothing jumps
 * when the panels arrive.
 */
export function ApprovalSettingsLoading() {
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col" aria-busy="true">
			<div className="page-measure min-w-0 space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-40 sm:h-9" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<div className="space-y-4">
					<Skeleton className="h-9 w-full max-w-2xl" />
					<Skeleton className="h-[420px] w-full" />
				</div>
			</div>
		</div>
	);
}
