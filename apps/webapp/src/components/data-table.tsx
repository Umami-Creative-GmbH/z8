"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	type UniqueIdentifier,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
	arrayMove,
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronsLeft,
	IconChevronsRight,
	IconCircleCheckFilled,
	IconDotsVertical,
	IconGripVertical,
	IconLayoutColumns,
	IconLoader,
	IconPlus,
	IconTrendingUp,
} from "@tabler/icons-react";
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFacetedRowModel,
	getFacetedUniqueValues,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import React from "react";
import { toast } from "sonner";
import { z } from "zod";

// Dynamically import heavy chart components - only loaded when drawer opens
const Area = dynamic(() => import("recharts").then((mod) => mod.Area), { ssr: false });
const AreaChart = dynamic(() => import("recharts").then((mod) => mod.AreaChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";

export const schema = z.object({
	id: z.number(),
	header: z.string(),
	type: z.string(),
	status: z.string(),
	target: z.string(),
	limit: z.string(),
	reviewer: z.string(),
});

// Create a separate component for the drag handle
function DragHandle({ id }: { id: number }) {
	const { attributes, listeners } = useSortable({
		id,
	});

	return (
		<Button
			{...attributes}
			{...listeners}
			className="size-7 text-muted-foreground hover:bg-transparent"
			size="icon"
			variant="ghost"
		>
			<IconGripVertical className="size-3 text-muted-foreground" />
			<span className="sr-only">Drag to reorder</span>
		</Button>
	);
}

const columns: ColumnDef<z.infer<typeof schema>>[] = [
	{
		id: "drag",
		header: () => null,
		cell: ({ row }) => <DragHandle id={row.original.id} />,
	},
	{
		id: "select",
		header: ({ table }) => (
			<div className="flex items-center justify-center">
				<Checkbox
					aria-label="Select all"
					checked={
						table.getIsAllPageRowsSelected() ||
						(table.getIsSomePageRowsSelected() && "indeterminate")
					}
					onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
				/>
			</div>
		),
		cell: ({ row }) => (
			<div className="flex items-center justify-center">
				<Checkbox
					aria-label="Select row"
					checked={row.getIsSelected()}
					onCheckedChange={(value) => row.toggleSelected(!!value)}
				/>
			</div>
		),
		enableSorting: false,
		enableHiding: false,
	},
	{
		accessorKey: "header",
		header: "Header",
		cell: ({ row }) => <TableCellViewer item={row.original} />,
		enableHiding: false,
	},
	{
		accessorKey: "type",
		header: "Section Type",
		cell: ({ row }) => (
			<div className="w-32">
				<Badge className="px-1.5 text-muted-foreground" variant="outline">
					{row.original.type}
				</Badge>
			</div>
		),
	},
	{
		accessorKey: "status",
		header: "Status",
		cell: ({ row }) => (
			<Badge className="px-1.5 text-muted-foreground" variant="outline">
				{row.original.status === "Done" ? (
					<IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
				) : (
					<IconLoader />
				)}
				{row.original.status}
			</Badge>
		),
	},
	{
		accessorKey: "target",
		header: () => <div className="w-full text-right">Target</div>,
		cell: ({ row }) => (
			<form
				onSubmit={(e) => {
					e.preventDefault();
					toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
						loading: `Saving ${row.original.header}`,
						success: "Done",
						error: "Error",
					});
				}}
			>
				<Label className="sr-only" htmlFor={`${row.original.id}-target`}>
					Target
				</Label>
				<Input
					className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:focus-visible:bg-input/30 dark:hover:bg-input/30"
					defaultValue={row.original.target}
					id={`${row.original.id}-target`}
				/>
			</form>
		),
	},
	{
		accessorKey: "limit",
		header: () => <div className="w-full text-right">Limit</div>,
		cell: ({ row }) => (
			<form
				onSubmit={(e) => {
					e.preventDefault();
					toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
						loading: `Saving ${row.original.header}`,
						success: "Done",
						error: "Error",
					});
				}}
			>
				<Label className="sr-only" htmlFor={`${row.original.id}-limit`}>
					Limit
				</Label>
				<Input
					className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:focus-visible:bg-input/30 dark:hover:bg-input/30"
					defaultValue={row.original.limit}
					id={`${row.original.id}-limit`}
				/>
			</form>
		),
	},
	{
		accessorKey: "reviewer",
		header: "Reviewer",
		cell: ({ row }) => {
			const isAssigned = row.original.reviewer !== "Assign reviewer";

			if (isAssigned) {
				return row.original.reviewer;
			}

			return (
				<>
					<Label className="sr-only" htmlFor={`${row.original.id}-reviewer`}>
						Reviewer
					</Label>
					<Select>
						<SelectTrigger
							className="w-38 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate"
							id={`${row.original.id}-reviewer`}
							size="sm"
						>
							<SelectValue placeholder="Assign reviewer" />
						</SelectTrigger>
						<SelectContent align="end">
							<SelectItem value="Eddie Lake">Eddie Lake</SelectItem>
							<SelectItem value="Jamik Tashpulatov">Jamik Tashpulatov</SelectItem>
						</SelectContent>
					</Select>
				</>
			);
		},
	},
	{
		id: "actions",
		cell: () => (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
						size="icon"
						variant="ghost"
					>
						<IconDotsVertical />
						<span className="sr-only">Open menu</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-32">
					<DropdownMenuItem>Edit</DropdownMenuItem>
					<DropdownMenuItem>Make a copy</DropdownMenuItem>
					<DropdownMenuItem>Favorite</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		),
	},
];

function DraggableRow({ row }: { row: Row<z.infer<typeof schema>> }) {
	const { transform, transition, setNodeRef, isDragging } = useSortable({
		id: row.original.id,
	});

	return (
		<TableRow
			className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
			data-dragging={isDragging}
			data-state={row.getIsSelected() && "selected"}
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
		>
			{row.getVisibleCells().map((cell) => (
				<TableCell key={cell.id}>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	);
}

export function DataTable({ data: initialData }: { data: z.infer<typeof schema>[] }) {
	const [data, setData] = React.useState(() => initialData);
	const [rowSelection, setRowSelection] = React.useState({});
	const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
	const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
	const [sorting, setSorting] = React.useState<SortingState>([]);
	const [pagination, setPagination] = React.useState({
		pageIndex: 0,
		pageSize: 10,
	});
	const sortableId = React.useId();
	const sensors = useSensors(
		useSensor(MouseSensor, {}),
		useSensor(TouchSensor, {}),
		useSensor(KeyboardSensor, {}),
	);

	const dataIds = React.useMemo<UniqueIdentifier[]>(() => data?.map(({ id }) => id) || [], [data]);

	const table = useReactTable({
		data,
		columns,
		state: {
			sorting,
			columnVisibility,
			rowSelection,
			columnFilters,
			pagination,
		},
		getRowId: (row) => row.id.toString(),
		enableRowSelection: true,
		onRowSelectionChange: setRowSelection,
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFacetedRowModel: getFacetedRowModel(),
		getFacetedUniqueValues: getFacetedUniqueValues(),
	});

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (active && over && active.id !== over.id) {
			setData((currentData) => {
				const oldIndex = dataIds.indexOf(active.id);
				const newIndex = dataIds.indexOf(over.id);
				return arrayMove(currentData, oldIndex, newIndex);
			});
		}
	}

	return (
		<Tabs className="w-full flex-col justify-start gap-6" defaultValue="outline">
			<div className="flex items-center justify-between px-4 lg:px-6">
				<Label className="sr-only" htmlFor="view-selector">
					View
				</Label>
				<Select defaultValue="outline">
					<SelectTrigger className="flex @4xl/main:hidden w-fit" id="view-selector" size="sm">
						<SelectValue placeholder="Select a view" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="outline">Outline</SelectItem>
						<SelectItem value="past-performance">Past Performance</SelectItem>
						<SelectItem value="key-personnel">Key Personnel</SelectItem>
						<SelectItem value="focus-documents">Focus Documents</SelectItem>
					</SelectContent>
				</Select>
				<TabsList className="@4xl/main:flex hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1">
					<TabsTrigger value="outline">Outline</TabsTrigger>
					<TabsTrigger value="past-performance">
						Past Performance <Badge variant="secondary">3</Badge>
					</TabsTrigger>
					<TabsTrigger value="key-personnel">
						Key Personnel <Badge variant="secondary">2</Badge>
					</TabsTrigger>
					<TabsTrigger value="focus-documents">Focus Documents</TabsTrigger>
				</TabsList>
				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" variant="outline">
								<IconLayoutColumns />
								<span className="hidden lg:inline">Customize Columns</span>
								<span className="lg:hidden">Columns</span>
								<IconChevronDown />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-56">
							{table
								.getAllColumns()
								.filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
								.map((column) => (
									<DropdownMenuCheckboxItem
										checked={column.getIsVisible()}
										className="capitalize"
										key={column.id}
										onCheckedChange={(value) => column.toggleVisibility(!!value)}
									>
										{column.id}
									</DropdownMenuCheckboxItem>
								))}
						</DropdownMenuContent>
					</DropdownMenu>
					<Button size="sm" variant="outline">
						<IconPlus />
						<span className="hidden lg:inline">Add Section</span>
					</Button>
				</div>
			</div>
			<TabsContent
				className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
				value="outline"
			>
				<div className="overflow-hidden rounded-lg border">
					<DndContext
						collisionDetection={closestCenter}
						id={sortableId}
						modifiers={[restrictToVerticalAxis]}
						onDragEnd={handleDragEnd}
						sensors={sensors}
					>
						<Table>
							<TableHeader className="sticky top-0 z-10 bg-muted">
								{table.getHeaderGroups().map((headerGroup) => (
									<TableRow key={headerGroup.id}>
										{headerGroup.headers.map((header) => (
											<TableHead colSpan={header.colSpan} key={header.id}>
												{header.isPlaceholder
													? null
													: flexRender(header.column.columnDef.header, header.getContext())}
											</TableHead>
										))}
									</TableRow>
								))}
							</TableHeader>
							<TableBody className="**:data-[slot=table-cell]:first:w-8">
								{table.getRowModel().rows?.length ? (
									<SortableContext items={dataIds} strategy={verticalListSortingStrategy}>
										{table.getRowModel().rows.map((row) => (
											<DraggableRow key={row.id} row={row} />
										))}
									</SortableContext>
								) : (
									<TableRow>
										<TableCell className="h-24 text-center" colSpan={columns.length}>
											No results.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</DndContext>
				</div>
				<div className="flex items-center justify-between px-4">
					<div className="hidden flex-1 text-muted-foreground text-sm lg:flex">
						{table.getFilteredSelectedRowModel().rows.length} of{" "}
						{table.getFilteredRowModel().rows.length} row(s) selected.
					</div>
					<div className="flex w-full items-center gap-8 lg:w-fit">
						<div className="hidden items-center gap-2 lg:flex">
							<Label className="font-medium text-sm" htmlFor="rows-per-page">
								Rows per page
							</Label>
							<Select
								onValueChange={(value) => {
									table.setPageSize(Number(value));
								}}
								value={`${table.getState().pagination.pageSize}`}
							>
								<SelectTrigger className="w-20" id="rows-per-page" size="sm">
									<SelectValue placeholder={table.getState().pagination.pageSize} />
								</SelectTrigger>
								<SelectContent side="top">
									{[10, 20, 30, 40, 50].map((pageSize) => (
										<SelectItem key={pageSize} value={`${pageSize}`}>
											{pageSize}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex w-fit items-center justify-center font-medium text-sm">
							Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
						</div>
						<div className="ml-auto flex items-center gap-2 lg:ml-0">
							<Button
								className="hidden h-8 w-8 p-0 lg:flex"
								disabled={!table.getCanPreviousPage()}
								onClick={() => table.setPageIndex(0)}
								variant="outline"
							>
								<span className="sr-only">Go to first page</span>
								<IconChevronsLeft />
							</Button>
							<Button
								className="size-8"
								disabled={!table.getCanPreviousPage()}
								onClick={() => table.previousPage()}
								size="icon"
								variant="outline"
							>
								<span className="sr-only">Go to previous page</span>
								<IconChevronLeft />
							</Button>
							<Button
								className="size-8"
								disabled={!table.getCanNextPage()}
								onClick={() => table.nextPage()}
								size="icon"
								variant="outline"
							>
								<span className="sr-only">Go to next page</span>
								<IconChevronRight />
							</Button>
							<Button
								className="hidden size-8 lg:flex"
								disabled={!table.getCanNextPage()}
								onClick={() => table.setPageIndex(table.getPageCount() - 1)}
								size="icon"
								variant="outline"
							>
								<span className="sr-only">Go to last page</span>
								<IconChevronsRight />
							</Button>
						</div>
					</div>
				</div>
			</TabsContent>
			<TabsContent className="flex flex-col px-4 lg:px-6" value="past-performance">
				<div className="aspect-video w-full flex-1 rounded-lg border border-dashed" />
			</TabsContent>
			<TabsContent className="flex flex-col px-4 lg:px-6" value="key-personnel">
				<div className="aspect-video w-full flex-1 rounded-lg border border-dashed" />
			</TabsContent>
			<TabsContent className="flex flex-col px-4 lg:px-6" value="focus-documents">
				<div className="aspect-video w-full flex-1 rounded-lg border border-dashed" />
			</TabsContent>
		</Tabs>
	);
}

const chartData = [
	{ month: "January", desktop: 186, mobile: 80 },
	{ month: "February", desktop: 305, mobile: 200 },
	{ month: "March", desktop: 237, mobile: 120 },
	{ month: "April", desktop: 73, mobile: 190 },
	{ month: "May", desktop: 209, mobile: 130 },
	{ month: "June", desktop: 214, mobile: 140 },
];

const chartConfig = {
	desktop: {
		label: "Desktop",
		color: "var(--primary)",
	},
	mobile: {
		label: "Mobile",
		color: "var(--primary)",
	},
} satisfies ChartConfig;

// Memoized chart section - only renders on desktop, extracted for performance
const ChartSection = React.memo(function ChartSection({
	trendingText,
	descriptionText,
}: {
	trendingText: string;
	descriptionText: string;
}) {
	return (
		<>
			<ChartContainer config={chartConfig}>
				<AreaChart
					accessibilityLayer
					data={chartData}
					margin={{
						left: 0,
						right: 10,
					}}
				>
					<CartesianGrid vertical={false} />
					<XAxis
						axisLine={false}
						dataKey="month"
						hide
						tickFormatter={(value) => value.slice(0, 3)}
						tickLine={false}
						tickMargin={8}
					/>
					<ChartTooltip content={<ChartTooltipContent indicator="dot" />} cursor={false} />
					<Area
						dataKey="mobile"
						fill="var(--color-mobile)"
						fillOpacity={0.6}
						stackId="a"
						stroke="var(--color-mobile)"
						type="natural"
					/>
					<Area
						dataKey="desktop"
						fill="var(--color-desktop)"
						fillOpacity={0.4}
						stackId="a"
						stroke="var(--color-desktop)"
						type="natural"
					/>
				</AreaChart>
			</ChartContainer>
			<Separator />
			<div className="grid gap-2">
				<div className="flex gap-2 font-medium leading-none">
					{trendingText} <IconTrendingUp className="size-4" />
				</div>
				<div className="text-muted-foreground">{descriptionText}</div>
			</div>
			<Separator />
		</>
	);
});

// Memoized TableCellViewer to prevent unnecessary re-renders
const TableCellViewer = React.memo(function TableCellViewer({
	item,
}: {
	item: z.infer<typeof schema>;
}) {
	const isMobile = useIsMobile();
	const { t } = useTranslate();

	// Pre-compute translations to avoid recalculating in render
	const translations = React.useMemo(
		() => ({
			showingVisitors: t("table.showing-visitors", "Showing total visitors for the last 6 months"),
			trendingUp: t("table.trending-up", "Trending up by 5.2% this month"),
			description: t(
				"table.description",
				"Showing total visitors for the last 6 months. This is just some random text to test the layout. It spans multiple lines and should wrap around.",
			),
			header: t("table.header", "Header"),
			type: t("table.type", "Type"),
			selectType: t("table.select-type", "Select a type"),
			status: t("table.status", "Status"),
			selectStatus: t("table.select-status", "Select a status"),
			target: t("table.target", "Target"),
			limit: t("table.limit", "Limit"),
			reviewer: t("table.reviewer", "Reviewer"),
			selectReviewer: t("table.select-reviewer", "Select a reviewer"),
			submit: t("generic.submit", "Submit"),
			done: t("generic.done", "Done"),
			typeOptions: {
				tableOfContents: t("table.type-options.table-of-contents", "Table of Contents"),
				executiveSummary: t("table.type-options.executive-summary", "Executive Summary"),
				technicalApproach: t("table.type-options.technical-approach", "Technical Approach"),
				design: t("table.type-options.design", "Design"),
				capabilities: t("table.type-options.capabilities", "Capabilities"),
				focusDocuments: t("table.type-options.focus-documents", "Focus Documents"),
				narrative: t("table.type-options.narrative", "Narrative"),
				coverPage: t("table.type-options.cover-page", "Cover Page"),
			},
			statusOptions: {
				done: t("table.status-options.done", "Done"),
				inProgress: t("table.status-options.in-progress", "In Progress"),
				notStarted: t("table.status-options.not-started", "Not Started"),
			},
		}),
		[t],
	);

	return (
		<Drawer direction={isMobile ? "bottom" : "right"}>
			<DrawerTrigger asChild>
				<Button className="w-fit px-0 text-left text-foreground" variant="link">
					{item.header}
				</Button>
			</DrawerTrigger>
			<DrawerContent>
				<DrawerHeader className="gap-1">
					<DrawerTitle>{item.header}</DrawerTitle>
					<DrawerDescription>{translations.showingVisitors}</DrawerDescription>
				</DrawerHeader>
				<div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
					{!isMobile && (
						<ChartSection
							trendingText={translations.trendingUp}
							descriptionText={translations.description}
						/>
					)}
					<form className="flex flex-col gap-4">
						<div className="flex flex-col gap-3">
							<Label htmlFor="header">{translations.header}</Label>
							<Input defaultValue={item.header} id="header" />
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="flex flex-col gap-3">
								<Label htmlFor="type">{translations.type}</Label>
								<Select defaultValue={item.type}>
									<SelectTrigger className="w-full" id="type">
										<SelectValue placeholder={translations.selectType} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="Table of Contents">
											{translations.typeOptions.tableOfContents}
										</SelectItem>
										<SelectItem value="Executive Summary">
											{translations.typeOptions.executiveSummary}
										</SelectItem>
										<SelectItem value="Technical Approach">
											{translations.typeOptions.technicalApproach}
										</SelectItem>
										<SelectItem value="Design">{translations.typeOptions.design}</SelectItem>
										<SelectItem value="Capabilities">
											{translations.typeOptions.capabilities}
										</SelectItem>
										<SelectItem value="Focus Documents">
											{translations.typeOptions.focusDocuments}
										</SelectItem>
										<SelectItem value="Narrative">{translations.typeOptions.narrative}</SelectItem>
										<SelectItem value="Cover Page">{translations.typeOptions.coverPage}</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex flex-col gap-3">
								<Label htmlFor="status">{translations.status}</Label>
								<Select defaultValue={item.status}>
									<SelectTrigger className="w-full" id="status">
										<SelectValue placeholder={translations.selectStatus} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="Done">{translations.statusOptions.done}</SelectItem>
										<SelectItem value="In Progress">
											{translations.statusOptions.inProgress}
										</SelectItem>
										<SelectItem value="Not Started">
											{translations.statusOptions.notStarted}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="flex flex-col gap-3">
								<Label htmlFor="target">{translations.target}</Label>
								<Input defaultValue={item.target} id="target" />
							</div>
							<div className="flex flex-col gap-3">
								<Label htmlFor="limit">{translations.limit}</Label>
								<Input defaultValue={item.limit} id="limit" />
							</div>
						</div>
						<div className="flex flex-col gap-3">
							<Label htmlFor="reviewer">{translations.reviewer}</Label>
							<Select defaultValue={item.reviewer}>
								<SelectTrigger className="w-full" id="reviewer">
									<SelectValue placeholder={translations.selectReviewer} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="Eddie Lake">Eddie Lake</SelectItem>
									<SelectItem value="Jamik Tashpulatov">Jamik Tashpulatov</SelectItem>
									<SelectItem value="Emily Whalen">Emily Whalen</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</form>
				</div>
				<DrawerFooter>
					<Button>{translations.submit}</Button>
					<DrawerClose asChild>
						<Button variant="outline">{translations.done}</Button>
					</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
});
