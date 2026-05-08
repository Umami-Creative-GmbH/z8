"use client";

import {
	IconCheck,
	IconDots,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	deleteAbsenceCategory,
	getAbsenceCategoriesForSettings,
	setAbsenceCategoryActive,
} from "@/app/[locale]/(app)/settings/vacation/actions";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
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
import { queryKeys } from "@/lib/query/keys";
import { AbsenceCategoryForm, type AbsenceCategoryForSettings } from "./absence-category-form";

interface AbsenceCategoriesTableProps {
	organizationId: string;
	canManageCategories: boolean;
}

const getCategoryTypeLabel = (t: ReturnType<typeof useTranslate>["t"], type: string) => {
	const labels: Record<string, string> = {
		bereavement: t("settings.absenceCategories.type.bereavement", "Bereavement"),
		custom: t("settings.absenceCategories.type.custom", "Custom"),
		home_office: t("settings.absenceCategories.type.homeOffice", "Home Office"),
		parental: t("settings.absenceCategories.type.parental", "Parental Leave"),
		personal: t("settings.absenceCategories.type.personal", "Personal"),
		sick: t("settings.absenceCategories.type.sick", "Sick Leave"),
		unpaid: t("settings.absenceCategories.type.unpaid", "Unpaid"),
		vacation: t("settings.absenceCategories.type.vacation", "Vacation"),
	};

	return labels[type] || type;
};

export function AbsenceCategoriesTable({
	organizationId,
	canManageCategories,
}: AbsenceCategoriesTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [categoryToDelete, setCategoryToDelete] = useState<AbsenceCategoryForSettings | null>(null);
	const [editingCategory, setEditingCategory] = useState<AbsenceCategoryForSettings | null>(null);
	const [createFormOpen, setCreateFormOpen] = useState(false);

	const queryKey = queryKeys.absenceCategories.list(organizationId);
	const {
		data: categories,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getAbsenceCategoriesForSettings(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch absence categories");
			}

			return result.data as AbsenceCategoryForSettings[];
		},
	});

	const toggleActiveMutation = useMutation({
		mutationFn: (category: AbsenceCategoryForSettings) =>
			setAbsenceCategoryActive(category.id, !category.isActive),
		onSuccess: (result, category) => {
			if (result.success) {
				toast.success(
					category.isActive
						? t("settings.absenceCategories.categoryDeactivated", "Absence category deactivated")
						: t("settings.absenceCategories.categoryReactivated", "Absence category reactivated"),
				);
				queryClient.invalidateQueries({ queryKey });
			} else {
				toast.error(
					result.error ||
						t("settings.absenceCategories.statusUpdateFailed", "Could not update category status"),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.absenceCategories.statusUpdateFailed", "Could not update category status"),
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (categoryId: string) => deleteAbsenceCategory(categoryId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.absenceCategories.categoryDeleted", "Absence category deleted"));
				queryClient.invalidateQueries({ queryKey });
				setCategoryToDelete(null);
			} else {
				toast.error(
					result.error || t("settings.absenceCategories.deleteFailed", "Could not delete category"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.absenceCategories.deleteFailed", "Could not delete category"));
		},
	});
	const toggleActive = toggleActiveMutation.mutate;
	const toggleActivePending = toggleActiveMutation.isPending;

	const filteredCategories = useMemo(() => {
		if (!categories) return [];
		if (!search) return categories;

		const searchLower = search.toLowerCase();
		return categories.filter((category) => category.name.toLowerCase().includes(searchLower));
	}, [categories, search]);

	const columns = useMemo<ColumnDef<AbsenceCategoryForSettings>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("settings.absenceCategories.header.name", "Name"),
				cell: ({ row }) => (
					<div className="flex items-center gap-2">
						{row.original.color ? (
							<span
								className="h-3 w-3 shrink-0 rounded-full border"
								style={{ backgroundColor: row.original.color }}
								title={t("settings.absenceCategories.colorIndicator", "Category color")}
							/>
						) : null}
						<div className="min-w-0">
							<div className="font-medium">{row.original.name}</div>
							{row.original.description ? (
								<div className="break-words text-muted-foreground text-sm">
									{row.original.description}
								</div>
							) : null}
						</div>
					</div>
				),
			},
			{
				accessorKey: "type",
				header: t("settings.absenceCategories.header.type", "Type"),
				cell: ({ row }) => (
					<Badge variant="secondary">{getCategoryTypeLabel(t, row.original.type)}</Badge>
				),
			},
			{
				accessorKey: "requiresApproval",
				header: t("settings.absenceCategories.header.approval", "Approval"),
				cell: ({ row }) =>
					row.original.requiresApproval ? (
						<Badge variant="outline">
							{t("settings.absenceCategories.approvalRequired", "Required")}
						</Badge>
					) : (
						<span className="text-muted-foreground text-sm">
							{t("settings.absenceCategories.noApproval", "Not required")}
						</span>
					),
			},
			{
				accessorKey: "countsAgainstVacation",
				header: t("settings.absenceCategories.header.vacationBalance", "Vacation Balance"),
				cell: ({ row }) =>
					row.original.countsAgainstVacation ? (
						<Badge variant="outline">
							{t("settings.absenceCategories.countsAgainstVacation", "Deducts balance")}
						</Badge>
					) : (
						<span className="text-muted-foreground text-sm">
							{t("settings.absenceCategories.noVacationDeduction", "No deduction")}
						</span>
					),
			},
			{
				accessorKey: "isActive",
				header: t("settings.absenceCategories.header.status", "Status"),
				cell: ({ row }) =>
					row.original.isActive ? (
						<Badge variant="outline">{t("settings.absenceCategories.active", "Active")}</Badge>
					) : (
						<Badge variant="secondary" className="text-muted-foreground">
							{t("settings.absenceCategories.inactive", "Inactive")}
						</Badge>
					),
			},
			...(canManageCategories
				? [
						{
							id: "actions",
							cell: ({ row }: { row: { original: AbsenceCategoryForSettings } }) => (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label={`${t("common.openMenu", "Open menu")} ${row.original.name}`}
										>
											<IconDots aria-hidden="true" className="h-4 w-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => setEditingCategory(row.original)}>
											<IconPencil aria-hidden="true" className="mr-2 h-4 w-4" />
											{t("common.edit", "Edit")}
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => toggleActive(row.original)}
											disabled={toggleActivePending}
										>
											{row.original.isActive ? (
												<IconX aria-hidden="true" className="mr-2 h-4 w-4" />
											) : (
												<IconCheck aria-hidden="true" className="mr-2 h-4 w-4" />
											)}
											{row.original.isActive
												? t("settings.absenceCategories.deactivate", "Deactivate")
												: t("settings.absenceCategories.reactivate", "Reactivate")}
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											className="text-destructive"
											onClick={() => setCategoryToDelete(row.original)}
										>
											<IconTrash aria-hidden="true" className="mr-2 h-4 w-4" />
											{t("common.delete", "Delete")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							),
						},
					]
				: []),
		],
		[t, canManageCategories, toggleActive, toggleActivePending],
	);

	const handleFormClose = (open: boolean) => {
		if (!open) {
			setEditingCategory(null);
			setCreateFormOpen(false);
			queryClient.invalidateQueries({ queryKey });
		}
	};

	if (isLoading) {
		return (
			<div className="space-y-4">
				{canManageCategories ? (
					<div className="flex justify-end">
						<Button onClick={() => setCreateFormOpen(true)}>
							<IconPlus aria-hidden="true" className="mr-2 h-4 w-4" />
							{t("settings.absenceCategories.addCategory", "Add category")}
						</Button>
					</div>
				) : null}
				<DataTableSkeleton columnCount={canManageCategories ? 6 : 5} rowCount={5} />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border py-12 text-center">
				<p className="text-destructive">
					{t("settings.absenceCategories.loadError", "Failed to load absence categories")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh aria-hidden="true" className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<>
			<div className="space-y-4">
				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchPlaceholder={t(
						"settings.absenceCategories.searchPlaceholder",
						"Search categories…",
					)}
					actions={
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
								{isFetching ? (
									<IconLoader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
								) : (
									<IconRefresh aria-hidden="true" className="h-4 w-4" />
								)}
								<span className="sr-only">{t("common.refresh", "Refresh")}</span>
							</Button>
							{canManageCategories ? (
								<Button onClick={() => setCreateFormOpen(true)}>
									<IconPlus aria-hidden="true" className="mr-2 h-4 w-4" />
									{t("settings.absenceCategories.addCategory", "Add category")}
								</Button>
							) : null}
						</div>
					}
				/>

				<DataTable
					columns={columns}
					data={filteredCategories}
					isFetching={isFetching}
					emptyMessage={
						search
							? t("settings.absenceCategories.noSearchResults", "No categories match your search.")
							: t(
									"settings.absenceCategories.noCategories",
									"No absence categories created yet. Create categories to define how absence time is recorded.",
								)
					}
				/>
			</div>

			<AlertDialog
				open={!!categoryToDelete}
				onOpenChange={(open) => !open && setCategoryToDelete(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.absenceCategories.deleteTitle", "Delete Absence Category")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.absenceCategories.deleteDescription",
								'Are you sure you want to delete "{name}"? Categories used by existing absences cannot be deleted and should be deactivated instead.',
								{ name: categoryToDelete?.name },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (categoryToDelete) {
									deleteMutation.mutate(categoryToDelete.id);
								}
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? (
								<IconLoader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
							) : null}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{canManageCategories && editingCategory ? (
				<AbsenceCategoryForm
					open={!!editingCategory}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
					existingCategory={editingCategory}
				/>
			) : null}

			{canManageCategories && createFormOpen ? (
				<AbsenceCategoryForm
					open={createFormOpen}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
				/>
			) : null}
		</>
	);
}
