"use client";

import {
	IconDots,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	deleteTimeRegulation,
	getTimeRegulations,
	type TimeRegulationWithBreakRules,
} from "@/app/[locale]/(app)/settings/time-regulations/actions";
import {
	DataTable,
	DataTableSkeleton,
	DataTableToolbar,
} from "@/components/data-table-server";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryKeys } from "@/lib/query";

interface TimeRegulationTemplatesTableProps {
	organizationId: string;
	onCreateClick: () => void;
	onEditClick: (regulation: TimeRegulationWithBreakRules) => void;
}

export function TimeRegulationTemplatesTable({
	organizationId,
	onCreateClick,
	onEditClick,
}: TimeRegulationTemplatesTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [regulationToDelete, setRegulationToDelete] = useState<TimeRegulationWithBreakRules | null>(
		null,
	);
	const [search, setSearch] = useState("");

	// Helper function to format minutes to hours with translation
	const formatMinutesToHours = (minutes: number | null): string => {
		if (minutes === null) return "—";
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (mins === 0) {
			return t("settings.timeRegulations.hoursFormat", "{hours}h", { hours });
		}
		return t("settings.timeRegulations.hoursMinutesFormat", "{hours}h {mins}m", { hours, mins });
	};

	// Fetch regulations
	const {
		data: regulations,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: queryKeys.timeRegulations.list(organizationId),
		queryFn: async () => {
			const result = await getTimeRegulations(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch regulations");
			}
			return result.data;
		},
		staleTime: 30 * 1000,
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (regulationId: string) => deleteTimeRegulation(regulationId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.timeRegulations.deleted", "Regulation deleted"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeRegulations.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setRegulationToDelete(null);
			} else {
				toast.error(result.error || t("settings.timeRegulations.deleteFailed", "Failed to delete"));
			}
		},
		onError: () => {
			toast.error(t("settings.timeRegulations.deleteFailed", "Failed to delete regulation"));
		},
	});

	const handleDeleteClick = (regulation: TimeRegulationWithBreakRules) => {
		setRegulationToDelete(regulation);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (regulationToDelete) {
			deleteMutation.mutate(regulationToDelete.id);
		}
	};

	// Filter regulations by search (client-side since typically small list)
	const filteredRegulations = useMemo(() => {
		if (!regulations) return [];
		if (!search) return regulations;

		const searchLower = search.toLowerCase();
		return regulations.filter(
			(reg) =>
				reg.name.toLowerCase().includes(searchLower) ||
				reg.description?.toLowerCase().includes(searchLower),
		);
	}, [regulations, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<TimeRegulationWithBreakRules>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("settings.timeRegulations.name", "Name"),
				cell: ({ row }) => (
					<div>
						<div className="flex items-center gap-2">
							<span className="font-medium">{row.original.name}</span>
							{!row.original.isActive && (
								<Badge variant="secondary" className="text-xs">
									{t("common.inactive", "Inactive")}
								</Badge>
							)}
						</div>
						{row.original.description && (
							<p className="text-xs text-muted-foreground mt-0.5">
								{row.original.description}
							</p>
						)}
					</div>
				),
			},
			{
				accessorKey: "maxDailyMinutes",
				header: () => (
					<div className="text-center">
						{t("settings.timeRegulations.maxDaily", "Max Daily")}
					</div>
				),
				cell: ({ row }) => (
					<div className="text-center tabular-nums">
						{formatMinutesToHours(row.original.maxDailyMinutes)}
					</div>
				),
			},
			{
				accessorKey: "maxWeeklyMinutes",
				header: () => (
					<div className="text-center">
						{t("settings.timeRegulations.maxWeekly", "Max Weekly")}
					</div>
				),
				cell: ({ row }) => (
					<div className="text-center tabular-nums">
						{formatMinutesToHours(row.original.maxWeeklyMinutes)}
					</div>
				),
			},
			{
				accessorKey: "maxUninterruptedMinutes",
				header: () => (
					<div className="text-center">
						{t("settings.timeRegulations.maxUninterrupted", "Max Uninterrupted")}
					</div>
				),
				cell: ({ row }) => (
					<div className="text-center tabular-nums">
						{formatMinutesToHours(row.original.maxUninterruptedMinutes)}
					</div>
				),
			},
			{
				accessorKey: "breakRules",
				header: () => (
					<div className="text-center">
						{t("settings.timeRegulations.breakRules", "Break Rules")}
					</div>
				),
				cell: ({ row }) => (
					<div className="text-center">
						<Badge variant="outline">{row.original.breakRules?.length || 0}</Badge>
					</div>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<IconDots className="h-4 w-4" />
								<span className="sr-only">{t("common.openMenu", "Open menu")}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEditClick(row.original)}>
								<IconPencil className="mr-2 h-4 w-4" />
								{t("common.edit", "Edit")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive"
								onClick={() => handleDeleteClick(row.original)}
							>
								<IconTrash className="mr-2 h-4 w-4" />
								{t("common.delete", "Delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				),
			},
		],
		[t, onEditClick, formatMinutesToHours],
	);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-end">
					<Button onClick={onCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.timeRegulations.create", "Create Regulation")}
					</Button>
				</div>
				<DataTableSkeleton columnCount={6} rowCount={5} />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
				<p className="text-destructive">
					{t("settings.timeRegulations.loadError", "Failed to load regulations")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<DataTableToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder={t(
					"settings.timeRegulations.searchPlaceholder",
					"Search regulations...",
				)}
				actions={
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
							{isFetching ? (
								<IconLoader2 className="h-4 w-4 animate-spin" />
							) : (
								<IconRefresh className="h-4 w-4" />
							)}
							<span className="sr-only">{t("common.refresh", "Refresh")}</span>
						</Button>
						<Button onClick={onCreateClick}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.timeRegulations.create", "Create Regulation")}
						</Button>
					</div>
				}
			/>

			<DataTable
				columns={columns}
				data={filteredRegulations}
				isFetching={isFetching}
				emptyMessage={
					search
						? t("settings.timeRegulations.noSearchResults", "No regulations match your search.")
						: t(
								"settings.timeRegulations.noRegulations",
								"No time regulations. Create a regulation to define working time limits and break requirements.",
							)
				}
			/>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.timeRegulations.deleteTitle", "Delete Regulation")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.timeRegulations.deleteDescription",
								'Are you sure you want to delete "{name}"? This will also remove all assignments for this regulation. This action cannot be undone.',
								{ name: regulationToDelete?.name },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
