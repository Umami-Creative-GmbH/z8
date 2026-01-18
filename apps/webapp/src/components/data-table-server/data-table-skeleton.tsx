"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

interface DataTableSkeletonProps {
	/**
	 * Number of columns to display
	 */
	columnCount: number;
	/**
	 * Number of rows to display
	 * @default 10
	 */
	rowCount?: number;
	/**
	 * Whether to show a search/filter bar skeleton
	 * @default true
	 */
	showToolbar?: boolean;
	/**
	 * Whether to show pagination skeleton
	 * @default true
	 */
	showPagination?: boolean;
	/**
	 * Whether to show selection checkbox column
	 * @default false
	 */
	showSelection?: boolean;
}

export function DataTableSkeleton({
	columnCount,
	rowCount = 10,
	showToolbar = true,
	showPagination = true,
	showSelection = false,
}: DataTableSkeletonProps) {
	const totalColumns = showSelection ? columnCount + 1 : columnCount;

	return (
		<div className="space-y-4">
			{showToolbar && (
				<div className="flex items-center justify-between">
					<Skeleton className="h-10 w-[250px]" />
					<div className="flex items-center gap-2">
						<Skeleton className="h-10 w-[100px]" />
						<Skeleton className="h-10 w-[100px]" />
					</div>
				</div>
			)}

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							{showSelection && (
								<TableHead className="w-12">
									<Skeleton className="h-4 w-4" />
								</TableHead>
							)}
							{Array.from({ length: columnCount }).map((_, i) => (
								<TableHead key={i}>
									<Skeleton className="h-4 w-[80px]" />
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{Array.from({ length: rowCount }).map((_, rowIndex) => (
							<TableRow key={rowIndex}>
								{showSelection && (
									<TableCell>
										<Skeleton className="h-4 w-4" />
									</TableCell>
								)}
								{Array.from({ length: columnCount }).map((_, colIndex) => (
									<TableCell key={colIndex}>
										<Skeleton className="h-4 w-full max-w-[150px]" />
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{showPagination && (
				<div className="flex items-center justify-between px-2">
					<Skeleton className="h-5 w-[100px]" />
					<div className="flex items-center gap-6">
						<div className="flex items-center gap-2">
							<Skeleton className="h-5 w-[100px]" />
							<Skeleton className="h-8 w-[70px]" />
						</div>
						<Skeleton className="h-5 w-[100px]" />
						<div className="flex items-center gap-2">
							<Skeleton className="h-8 w-8" />
							<Skeleton className="h-8 w-8" />
							<Skeleton className="h-8 w-8" />
							<Skeleton className="h-8 w-8" />
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
