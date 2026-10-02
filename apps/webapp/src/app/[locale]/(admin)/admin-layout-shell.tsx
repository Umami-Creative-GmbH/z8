import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminLayoutShell() {
	return (
		<div className="min-h-screen bg-background">
			<header className="flex h-16 items-center border-b px-6">
				<Skeleton className="size-9 rounded-lg" />
				<Skeleton className="ml-3 h-5 w-36" />
				<Skeleton className="ml-auto size-8 rounded-full" />
			</header>
			<LoadingRegion
				aria-busy="true"
				as="main"
				label={{
					labelKey: "common.loadingRegions.adminConsole",
					labelDefault: "Loading admin console",
				}}
				className="mx-auto max-w-screen-2xl space-y-4 px-6 py-8"
			>
				<Skeleton className="h-8 w-52" />
				<Skeleton className="h-64 w-full" />
			</LoadingRegion>
		</div>
	);
}
