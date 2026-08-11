import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalizedLoadingLabel } from "./localized-loading-label";

export function AppFrameLoading() {
	return (
		<AppFrameVisual>
			<LocalizedLoadingLabel
				translationKey="common:loading.application"
				fallback="Loading application"
			/>
		</AppFrameVisual>
	);
}

export function NeutralAppFrameLoading() {
	return <AppFrameVisual />;
}

function AppFrameVisual({ children }: { children?: ReactNode }) {
	return (
		<div aria-busy="true" className="flex min-h-svh w-full" role="status">
			{children}
			<aside
				className="hidden w-72 shrink-0 border-r p-4 md:block"
				data-testid="app-sidebar-loading"
			>
				<Skeleton aria-hidden="true" className="mb-6 h-8 w-32" />
				<div className="space-y-3">
					<Skeleton aria-hidden="true" className="h-8 w-full" />
					<Skeleton aria-hidden="true" className="h-8 w-full" />
					<Skeleton aria-hidden="true" className="h-8 w-full" />
					<Skeleton aria-hidden="true" className="h-8 w-full" />
					<Skeleton aria-hidden="true" className="h-8 w-full" />
					<Skeleton aria-hidden="true" className="h-8 w-full" />
					<Skeleton aria-hidden="true" className="h-8 w-full" />
				</div>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<header
					className="flex h-12 items-center border-b px-4"
					data-testid="app-header-loading"
				>
					<Skeleton aria-hidden="true" className="h-7 w-40 max-w-2/3" />
				</header>
				<main className="flex-1 p-4">
					<Skeleton aria-hidden="true" className="h-full min-h-72 w-full" />
				</main>
			</div>
		</div>
	);
}
