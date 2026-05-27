"use client";

import { IconArrowsUpDown, IconExternalLink, IconSearch } from "@tabler/icons-react";
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
} from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useCompilerSafeReactTable } from "@/components/use-compiler-safe-react-table";
import type { LicenseInfo, LicenseReport } from "@/types/license";

type LicenseTableProps = {
	licenses: LicenseReport;
};

function getLicenseBadgeVariant(license: string): "default" | "secondary" | "outline" {
	const permissive = ["MIT", "ISC", "BSD", "Apache", "0BSD", "Unlicense", "CC0"];
	if (permissive.some((p) => license.toUpperCase().includes(p.toUpperCase()))) {
		return "secondary";
	}
	return "outline";
}

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
	const columns: ColumnDef<LicenseInfo>[] = [
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
			cell: ({ row }) => <span className="font-medium">{row.getValue("name")}</span>,
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
					<Badge variant={getLicenseBadgeVariant(license)}>
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
					<div className="flex gap-2">
						{repoUrl && (
							<a
								className="text-muted-foreground hover:text-foreground"
								href={repoUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								<IconExternalLink aria-hidden="true" className="size-4" />
								<span className="sr-only">{t("settings.licenses.repository", "Repository")}</span>
							</a>
						)}
						{homepage && homepage !== repoUrl && (
							<a
								className="text-muted-foreground hover:text-foreground"
								href={homepage}
								rel="noopener noreferrer"
								target="_blank"
							>
								<IconExternalLink aria-hidden="true" className="size-4" />
								<span className="sr-only">{t("settings.licenses.homepage", "Homepage")}</span>
							</a>
						)}
					</div>
				);
			},
		},
	];
	const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

	const table = useCompilerSafeReactTable({
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
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
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
		<div className="flex h-full min-h-0 flex-col gap-4">
			<div className="shrink-0">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="relative max-w-sm flex-1">
						<IconSearch
							aria-hidden="true"
							className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
						/>
						<Input
							className="pl-9"
							onChange={(e) => setGlobalFilter(e.target.value)}
							placeholder={t("settings.licenses.searchPlaceholder", "Search packages or licenses…")}
							value={globalFilter}
						/>
					</div>
					<div className="flex gap-4 text-muted-foreground text-sm">
						<span>
							{t("settings.licenses.packagesCount", "{count} packages", { count: stats.total })}
						</span>
						<span>
							{t("settings.licenses.licenseTypesCount", "{count} license types", {
								count: stats.uniqueLicenses,
							})}
						</span>
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background/60 dark:bg-background/35 [&_[data-slot=table-container]]:min-w-full">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										className="sticky top-0 z-10 bg-muted/95 py-2 backdrop-blur-sm"
									>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
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
										<TableCell key={cell.id}>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell className="h-24 text-center" colSpan={columns.length}>
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
