import { Skeleton } from "@/components/ui/skeleton";

export function BillableTimeSettingsLoading() {
	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}
