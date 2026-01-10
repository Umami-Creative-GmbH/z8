"use client";

import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";
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

const columns: ColumnDef<LicenseInfo>[] = [
	{
		accessorKey: "name",
		header: ({ column }) => (
			<Button
				className="-ml-3"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				variant="ghost"
			>
				Package
				<ArrowUpDown className="ml-2 h-4 w-4" />
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
				License
				<ArrowUpDown className="ml-2 h-4 w-4" />
			</Button>
		),
		cell: ({ row }) => {
			const license = row.getValue("license") as string;
			return <Badge variant={getLicenseBadgeVariant(license)}>{license || "Unknown"}</Badge>;
		},
	},
	{
		id: "links",
		header: "Links",
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
							<ExternalLink className="h-4 w-4" />
							<span className="sr-only">Repository</span>
						</a>
					)}
					{homepage && homepage !== repoUrl && (
						<a
							className="text-muted-foreground hover:text-foreground"
							href={homepage}
							rel="noopener noreferrer"
							target="_blank"
						>
							<ExternalLink className="h-4 w-4" />
							<span className="sr-only">Homepage</span>
						</a>
					)}
				</div>
			);
		},
	},
];

export function LicenseTable({ licenses }: LicenseTableProps) {
	const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

	const table = useReactTable({
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

	const stats = useMemo(() => {
		const licenseTypes = new Map<string, number>();
		for (const pkg of licenses) {
			const license = pkg.license || "Unknown";
			licenseTypes.set(license, (licenseTypes.get(license) || 0) + 1);
		}
		return {
			total: licenses.length,
			uniqueLicenses: licenseTypes.size,
		};
	}, [licenses]);

	return (
		<div className="flex h-full flex-col gap-4">
			{/* Fixed header section */}
			<div className="shrink-0">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="relative max-w-sm flex-1">
						<Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
						<Input
							className="pl-9"
							onChange={(e) => setGlobalFilter(e.target.value)}
							placeholder="Search packages or licenses..."
							value={globalFilter}
						/>
					</div>
					<div className="flex gap-4 text-muted-foreground text-sm">
						<span>{stats.total} packages</span>
						<span>{stats.uniqueLicenses} license types</span>
					</div>
				</div>
			</div>

			{/* Scrollable table section */}
			<div className="min-h-0 flex-1 overflow-hidden rounded-lg border [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-y-auto">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead key={header.id} className="sticky top-0 z-10 bg-muted py-2">
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
									No packages found.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			{/* Fixed footer section */}
			<p className="shrink-0 text-muted-foreground text-xs">
				This application uses open source software. Thank you to all the maintainers and
				contributors of these packages. ❤️
			</p>
		</div>
	);
}
