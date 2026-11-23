import { Skeleton } from "@/components/ui/skeleton";

/**
 * A content-area fallback that names no page, like `NeutralAppFrameLoading` for the app frame.
 * Guarded routes show it while their server guard decides, so nobody sees a page's shape or
 * label before access is settled.
 */
export function NeutralPageLoading() {
	return (
		<div aria-busy="true" className="page-frame flex flex-1 flex-col gap-6" role="status">
			<Skeleton aria-hidden="true" className="h-8 w-48 max-w-full" />
			<Skeleton aria-hidden="true" className="h-64 w-full rounded-xl" />
		</div>
	);
}
