import { Skeleton } from "@/components/ui/skeleton";

export function BillableTimeSettingsLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}
