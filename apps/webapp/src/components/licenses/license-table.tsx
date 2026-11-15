"use client";

import { IconArrowsUpDown, IconExternalLink } from "@tabler/icons-react";
import {
	type ColumnDef,
	type ColumnFiltersState,
	columnFilteringFeature,
	columnVisibilityFeature,
	createFilteredRowModel,
	createSortedRowModel,
	filterFn_includesString,
	flexRender,
	globalFilteringFeature,
	rowSortingFeature,
	type SortingState,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { LicenseInfo, LicenseReport } from "@/types/license";

type LicenseTableProps = {
	licenses: LicenseReport;
};

const licenseTableFeatures = tableFeatures({
	columnFilteringFeature,
	globalFilteringFeature,
	columnVisibilityFeature,
	rowSortingFeature,
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	filterFns: {
		includesString: filterFn_includesString,
	},
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		text: sortFn_text,
	},
});

function normalizeRepoUrl(
	repository?: string | { type?: string; url?: string; directory?: string },
): string | undefined {
	if (!repository) return undefined;
	const url = typeof repository === "string" ? repository : repository.url;
	if (!url) return undefined;
	// Handle short repo formats like "lodash/lodash" or "user/repo"
	if (!url.includes("://") && url.includes("/")) {
		return `https://github.com/${url}`;
	}
	return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

export function LicenseTable({ licenses }: LicenseTableProps) {
	const { t } = useTranslate();
	const searchLabel = t(
		"settings.licenses.searchPlaceholder",
		"Search packages or licenses…",
	);
	const columns = useMemo<
		ColumnDef<typeof licenseTableFeatures, LicenseInfo>[]
	>(
		() => [
			{
				accessorKey: "name",
				header: ({ column }) => (
					<Button
						className="-ml-3"
						onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
						variant="ghost"
					>
						{t("settings.licenses.package", "Package")}
						<IconArrowsUpDown aria-hidden="true" className="ml-2 size-4" />
					</Button>
				),
				cell: ({ row }) => (
					<span
						className="font-medium break-words [overflow-wrap:anywhere]"
						translate="no"
					>
						{row.getValue("name")}
					</span>
				),
			},
			{
				accessorKey: "license",
				header: ({ column }) => (
					<Button
						className="-ml-3"
						onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
						variant="ghost"
					>
						{t("settings.licenses.license", "License")}
						<IconArrowsUpDown aria-hidden="true" className="ml-2 size-4" />
					</Button>
				),
				cell: ({ row }) => {
					const license = row.getValue("license") as string;
					return (
						<Badge
							className="whitespace-normal break-words"
							variant="secondary"
						>
							{license || t("settings.licenses.unknown", "Unknown")}
						</Badge>
					);
				},
			},
			{
				id: "links",
				header: t("settings.licenses.links", "Links"),
				cell: ({ row }) => {
					const { repository, homepage } = row.original;
					const repoUrl = normalizeRepoUrl(repository);

					return (
						<div className="flex flex-wrap gap-x-3 gap-y-1">
							{repoUrl && (
								<a
									className="inline-flex min-h-9 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-foreground"
									href={repoUrl}
									rel="noopener noreferrer"
									target="_blank"
								>
									<IconExternalLink aria-hidden="true" className="size-4" />
									<span>{t("settings.licenses.repository", "Repository")}</span>
								</a>
							)}
							{homepage && homepage !== repoUrl && (
								<a
									className="inline-flex min-h-9 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-foreground"
									href={homepage}
									rel="noopener noreferrer"
									target="_blank"
								>
									<IconExternalLink aria-hidden="true" className="size-4" />
									<span>{t("settings.licenses.homepage", "Homepage")}</span>
								</a>
							)}
						</div>
					);
				},
			},
		],
		[t],
	);
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "name", desc: false },
	]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

	const table = useTable({
		features: licenseTableFeatures,
		data: licenses,
		columns,
		state: {
			sorting,
			columnFilters,
			globalFilter,
		},
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onGlobalFilterChange: setGlobalFilter,
	});

	const stats = (() => {
		const licenseTypes = new Map<string, number>();
		for (const pkg of licenses) {
			const license = pkg.license || "Unknown";
			licenseTypes.set(license, (licenseTypes.get(license) || 0) + 1);
		}
		return {
			total: licenses.length,
			uniqueLicenses: licenseTypes.size,
		};
	})();

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
			<div className="shrink-0">
				<DataTableToolbar
					search={globalFilter}
					onSearchChange={setGlobalFilter}
					searchLabel={searchLabel}
					searchPlaceholder={searchLabel}
				/>
				<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm tabular-nums">
					<span>
						{t("settings.licenses.packagesCount", "{count} packages", {
							count: stats.total,
						})}
					</span>
					<span>
						{t("settings.licenses.licenseTypesCount", "{count} license types", {
							count: stats.uniqueLicenses,
						})}
					</span>
				</div>
			</div>

			<div className="min-h-48 flex-1 overflow-auto rounded-lg border bg-background [&_[data-slot=table-container]]:min-w-full">
				<Table
					aria-label={t("info.licenses", "Open Source Licenses")}
					mobileLayout="stacked"
				>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										aria-sort={
											header.column.getIsSorted() === "asc"
												? "ascending"
												: header.column.getIsSorted() === "desc"
													? "descending"
													: undefined
										}
										className="sticky top-0 z-10 bg-muted py-2"
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id}>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className="whitespace-normal [overflow-wrap:anywhere]"
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									className="h-24 text-center"
									colSpan={columns.length}
								>
									{t("settings.licenses.noPackages", "No packages found.")}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<p className="shrink-0 text-muted-foreground text-xs">
				{t(
					"settings.licenses.footer",
					"This application uses open source software. Thank you to all the maintainers and contributors of these packages.",
				)}
			</p>
		</div>
	);
}
