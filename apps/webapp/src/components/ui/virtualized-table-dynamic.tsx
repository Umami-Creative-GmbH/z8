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
import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { VirtualizedTableProps } from "./virtualized-table";

// Loading skeleton that matches table structure
export function TableSkeleton({ rowCount = 5 }: { rowCount?: number }) {
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
const VirtualizedTable = dynamic(
	() => import("./virtualized-table").then((mod) => mod.VirtualizedTable),
	{
		loading: () => <TableSkeleton />,
		ssr: false, // Virtualization requires client-side measurement
	},
);

export function DynamicVirtualizedTable<TData>(props: VirtualizedTableProps<TData>) {
	const TypedVirtualizedTable = VirtualizedTable as ComponentType<VirtualizedTableProps<TData>>;
	return <TypedVirtualizedTable {...props} />;
}

/**
 * Type exports for consumers
 */
export type {
	VirtualizedTableColumn,
	VirtualizedTableProps,
} from "./virtualized-table";
