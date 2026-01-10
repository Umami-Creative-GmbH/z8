"use client";

import {
	IconAlertCircle,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	bulkDeleteHolidays,
	deleteHoliday,
	getHolidays,
} from "@/app/[locale]/(app)/settings/holidays/actions";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query";

interface Holiday {
	id: string;
	name: string;
	description: string | null;
	startDate: Date;
	endDate: Date;
	recurrenceType: string;
	isActive: boolean;
	categoryId: string;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
}

interface HolidayListProps {
	organizationId: string;
	onAddClick: () => void;
	onEditClick: (holiday: Holiday) => void;
}

export function HolidayList({ organizationId, onAddClick, onEditClick }: HolidayListProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Selection state
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// Delete confirmation state
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [holidayToDelete, setHolidayToDelete] = useState<Holiday | null>(null);
	const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

	// Fetch holidays with TanStack Query
	const {
		data: holidays = [],
		isLoading,
		error,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: queryKeys.holidays.list(organizationId),
		queryFn: async () => {
			const result = await getHolidays(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to load holidays");
			}
			return result.data as Holiday[];
		},
	});

	// Single delete mutation
	const deleteMutation = useMutation({
		mutationFn: (holidayId: string) => deleteHoliday(holidayId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.deleted", "Holiday deleted successfully"));
				queryClient.invalidateQueries({ queryKey: queryKeys.holidays.list(organizationId) });
			} else {
				toast.error(
					result.error || t("settings.holidays.deleteFailed", "Failed to delete holiday"),
				);
			}
			setDeleteConfirmOpen(false);
			setHolidayToDelete(null);
		},
		onError: () => {
			toast.error(t("settings.holidays.deleteFailed", "Failed to delete holiday"));
			setDeleteConfirmOpen(false);
			setHolidayToDelete(null);
		},
	});

	// Bulk delete mutation
	const bulkDeleteMutation = useMutation({
		mutationFn: (ids: string[]) => bulkDeleteHolidays(ids),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.holidays.bulkDeleted", "{count} holidays deleted", {
						count: result.data.deleted,
					}),
				);
				queryClient.invalidateQueries({ queryKey: queryKeys.holidays.list(organizationId) });
				setSelectedIds(new Set());
			} else {
				toast.error(
					result.error || t("settings.holidays.bulkDeleteFailed", "Failed to delete holidays"),
				);
			}
			setBulkDeleteConfirmOpen(false);
		},
		onError: () => {
			toast.error(t("settings.holidays.bulkDeleteFailed", "Failed to delete holidays"));
			setBulkDeleteConfirmOpen(false);
		},
	});

	const handleDeleteClick = (holiday: Holiday) => {
		setHolidayToDelete(holiday);
		setDeleteConfirmOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (holidayToDelete) {
			deleteMutation.mutate(holidayToDelete.id);
		}
	};

	const handleBulkDeleteClick = () => {
		if (selectedIds.size > 0) {
			setBulkDeleteConfirmOpen(true);
		}
	};

	const handleBulkDeleteConfirm = () => {
		bulkDeleteMutation.mutate(Array.from(selectedIds));
	};

	const toggleSelection = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleSelectAll = () => {
		if (selectedIds.size === holidays.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(holidays.map((h) => h.id)));
		}
	};

	const formatDateRange = (startDate: Date | string, endDate: Date | string) => {
		const start = new Date(startDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
		const end = new Date(endDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});

		if (start === end) {
			return start;
		}

		return `${start} - ${end}`;
	};

	const isAllSelected = holidays.length > 0 && selectedIds.size === holidays.length;
	const isSomeSelected = selectedIds.size > 0 && selectedIds.size < holidays.length;

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.add", "Add Holiday")}
					</Button>
				</div>
				<div className="rounded-md border p-8 flex items-center justify-center">
					<div className="flex items-center gap-2 text-muted-foreground">
						<IconLoader2 className="h-5 w-5 animate-spin" />
						<span>{t("settings.holidays.loading", "Loading holidays...")}</span>
					</div>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.add", "Add Holiday")}
					</Button>
				</div>
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-4">
					<div className="flex items-center gap-2 text-destructive">
						<IconAlertCircle className="h-5 w-5" />
						<span>{error instanceof Error ? error.message : "Failed to load holidays"}</span>
					</div>
					<Button onClick={() => refetch()} variant="outline" size="sm">
						{t("common.retry", "Retry")}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<>
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<div className="flex items-center gap-2">
						{selectedIds.size > 0 && (
							<Button
								size="sm"
								variant="destructive"
								onClick={handleBulkDeleteClick}
								disabled={bulkDeleteMutation.isPending}
							>
								{bulkDeleteMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<IconTrash className="mr-2 h-4 w-4" />
								)}
								{t("settings.holidays.deleteSelected", "Delete ({count})", {
									count: selectedIds.size,
								})}
							</Button>
						)}
						<Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
							{isFetching ? (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<IconRefresh className="mr-2 h-4 w-4" />
							)}
							{t("common.refresh", "Refresh")}
						</Button>
						<Button size="sm" onClick={onAddClick}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.holidays.add", "Add Holiday")}
						</Button>
					</div>
				</div>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-12">
									<Checkbox
										checked={isAllSelected}
										onCheckedChange={toggleSelectAll}
										aria-label={t("common.selectAll", "Select all")}
										className={isSomeSelected ? "data-[state=checked]:bg-primary/50" : ""}
									/>
								</TableHead>
								<TableHead>{t("settings.holidays.list.name", "Name")}</TableHead>
								<TableHead>{t("settings.holidays.list.category", "Category")}</TableHead>
								<TableHead>{t("settings.holidays.list.date", "Date")}</TableHead>
								<TableHead>{t("settings.holidays.list.recurrence", "Recurrence")}</TableHead>
								<TableHead className="text-right">
									{t("settings.holidays.list.actions", "Actions")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{holidays.length === 0 ? (
								<TableRow>
									<TableCell colSpan={6} className="text-center text-muted-foreground h-24">
										{t(
											"settings.holidays.list.empty",
											"No holidays found. Add your first holiday to get started.",
										)}
									</TableCell>
								</TableRow>
							) : (
								holidays.map((holiday) => (
									<TableRow
										key={holiday.id}
										className={selectedIds.has(holiday.id) ? "bg-muted/50" : ""}
									>
										<TableCell>
											<Checkbox
												checked={selectedIds.has(holiday.id)}
												onCheckedChange={() => toggleSelection(holiday.id)}
												aria-label={t("common.selectRow", "Select row")}
											/>
										</TableCell>
										<TableCell>
											<div>
												<div className="font-medium">{holiday.name}</div>
												{holiday.description && (
													<div className="text-sm text-muted-foreground">{holiday.description}</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												{holiday.category.color && (
													<div
														className="h-3 w-3 rounded-full border"
														style={{ backgroundColor: holiday.category.color }}
													/>
												)}
												<span className="text-sm">{holiday.category.name}</span>
											</div>
										</TableCell>
										<TableCell>{formatDateRange(holiday.startDate, holiday.endDate)}</TableCell>
										<TableCell>
											{holiday.recurrenceType === "none" ? (
												<span className="text-sm text-muted-foreground">
													{t("settings.holidays.recurrence.none", "One-time")}
												</span>
											) : (
												<Badge variant="secondary">
													{t("settings.holidays.recurrence.yearly", "Yearly")}
												</Badge>
											)}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => onEditClick(holiday)}
													disabled={deleteMutation.isPending}
												>
													<IconPencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDeleteClick(holiday)}
													disabled={deleteMutation.isPending}
												>
													{deleteMutation.isPending && holidayToDelete?.id === holiday.id ? (
														<IconLoader2 className="h-4 w-4 animate-spin" />
													) : (
														<IconTrash className="h-4 w-4" />
													)}
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</div>

			{/* Single Delete Confirmation */}
			<AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.delete.title", "Delete Holiday")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.delete.description",
								'Are you sure you want to delete "{name}"? This action cannot be undone.',
								{ name: holidayToDelete?.name || "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={deleteMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Bulk Delete Confirmation */}
			<AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.bulkDelete.title", "Delete Multiple Holidays")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.bulkDelete.description",
								"Are you sure you want to delete {count} holidays? This action cannot be undone.",
								{ count: selectedIds.size },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={bulkDeleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleBulkDeleteConfirm}
							disabled={bulkDeleteMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{bulkDeleteMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							{t("settings.holidays.bulkDelete.confirm", "Delete {count} Holidays", {
								count: selectedIds.size,
							})}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
