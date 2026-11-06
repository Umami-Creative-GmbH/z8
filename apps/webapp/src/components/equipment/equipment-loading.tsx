"use client";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";

const SHELL = "@container/main flex flex-1 flex-col gap-6 py-4 md:py-6";

function HeaderSkeleton() {
	return (
		<div className="flex flex-col gap-3 px-4 sm:flex-row sm:justify-between lg:px-6">
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-4 w-80 max-w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-9 w-44" />
		</div>
	);
}

/** Streaming fallbacks shaped like the equipment pages they stand in for. */
export function EquipmentLoading({
	variant,
}: {
	variant: "overview" | "detail" | "employee" | "personal";
}) {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.equipment.loading",
				labelDefault: "Loading equipment",
			}}
			role="status"
			className={SHELL}
		>
			{variant === "detail" || variant === "employee" ? (
				<div className="px-4 lg:px-6">
					<Skeleton aria-hidden="true" className="h-8 w-40" />
				</div>
			) : null}
			<HeaderSkeleton />
			{variant === "overview" ? (
				<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
					{[0, 1, 2, 3].map((key) => (
						<Skeleton
							key={key}
							aria-hidden="true"
							className="h-28 w-full rounded-xl"
						/>
					))}
				</div>
			) : null}
			{variant === "detail" ? (
				<div className="grid gap-6 px-4 lg:px-6 @5xl/main:grid-cols-[minmax(0,1fr)_20rem]">
					<div className="space-y-6">
						<Skeleton aria-hidden="true" className="h-40 w-full rounded-xl" />
						<Skeleton aria-hidden="true" className="h-80 w-full rounded-xl" />
					</div>
					<div className="space-y-4">
						<Skeleton aria-hidden="true" className="h-24 w-full rounded-xl" />
						<Skeleton aria-hidden="true" className="h-48 w-full rounded-xl" />
					</div>
				</div>
			) : (
				<div className="px-4 lg:px-6">
					<Skeleton aria-hidden="true" className="h-96 w-full rounded-xl" />
				</div>
			)}
		</LoadingRegion>
	);
}
