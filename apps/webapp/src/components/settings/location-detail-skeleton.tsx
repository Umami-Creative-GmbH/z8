import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";

export function LocationDetailSkeleton() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-6"
			label={{
				labelKey: "common.loadingRegions.locationSettings",
				labelDefault: "Loading location settings",
			}}
		>
			<div className="space-y-2">
				<Skeleton className="h-5 w-36" aria-hidden="true" />
				<Skeleton className="h-8 w-56" aria-hidden="true" />
				<Skeleton className="h-5 w-full max-w-sm" aria-hidden="true" />
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				<Skeleton className="h-64" aria-hidden="true" />
				<Skeleton className="h-64" aria-hidden="true" />
			</div>
		</LoadingRegion>
	);
}
