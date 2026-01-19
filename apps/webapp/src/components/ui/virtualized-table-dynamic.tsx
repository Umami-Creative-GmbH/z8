"use client";

/**
 * Dynamic import wrapper for VirtualizedTable
 *
 * Use this instead of directly importing VirtualizedTable when:
 * - The table is below the fold or in a modal
 * - The page has other critical content to render first
 * - You want to reduce initial bundle size
 *
 * Rule: bundle-dynamic-imports
 */

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Loading skeleton that matches table structure
function TableSkeleton({ rowCount = 5 }: { rowCount?: number }) {
	return (
		<div className="rounded-md border">
			{/* Header skeleton */}
			<div className="border-b p-4">
				<div className="flex gap-4">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-20" />
					<Skeleton className="h-4 flex-1" />
				</div>
			</div>
			{/* Row skeletons */}
			<div className="divide-y">
				{Array.from({ length: rowCount }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton rows don't reorder
					<div key={i} className="flex gap-4 p-4">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-4 flex-1" />
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * Dynamically loaded VirtualizedTable
 * Only loads the @tanstack/react-virtual bundle when this component mounts
 */
export const DynamicVirtualizedTable = dynamic(
	() => import("./virtualized-table").then((mod) => mod.VirtualizedTable),
	{
		loading: () => <TableSkeleton />,
		ssr: false, // Virtualization requires client-side measurement
	},
);

/**
 * Type exports for consumers
 */
export type {
	VirtualizedTableColumn,
	VirtualizedTableProps,
} from "./virtualized-table";
/**
 * Hook exports need to be re-exported directly (can't be dynamically imported)
 */
export { useRowMemoization } from "./virtualized-table";
