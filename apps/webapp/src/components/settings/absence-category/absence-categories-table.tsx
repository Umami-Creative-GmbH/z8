"use client";

import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteAbsenceCategory,
	getAbsenceCategoriesForSettings,
	setAbsenceCategoryActive,
} from "@/app/[locale]/(app)/settings/vacation/actions";
import { DataTable, DataTableToolbar } from "@/components/data-table-server";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { Badge } from "@/components/ui/badge";
import { queryKeys } from "@/lib/query/keys";
import {
	AbsenceCategoriesErrorState,
	AbsenceCategoriesLoadingState,
	AbsenceCategoriesToolbarActions,
	AbsenceCategoryFormDialogs,
	AbsenceCategoryNameCell,
	type AbsenceCategoryRowActionHandlers,
	AbsenceCategoryRowActions,
	AbsenceCategoryVacationBalanceCell,
	DeleteAbsenceCategoryDialog,
} from "./absence-categories-table-parts";
import { filterAbsenceCategories, getCategoryTypeLabel } from "./absence-categories-table-utils";
import type { AbsenceCategoryForSettings } from "./absence-category-form-utils";

interface AbsenceCategoriesTableProps {
	organizationId: string;
	canManageCategories: boolean;
}

function buildAbsenceCategoryColumns({
	t,
	locale,
	canManageCategories,
	...actionHandlers
}: AbsenceCategoryRowActionHandlers & {
	t: ReturnType<typeof useTranslate>["t"];
	locale: string;
	canManageCategories: boolean;
}): ColumnDef<DataTableFeatures, AbsenceCategoryForSettings>[] {
	return [
		{
			accessorKey: "name",
			header: t("settings.absenceCategories.header.name", "Name"),
			cell: ({ row }) => <AbsenceCategoryNameCell category={row.original} locale={locale} t={t} />,
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
			cell: ({ row }) => <AbsenceCategoryVacationBalanceCell category={row.original} t={t} />,
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
							<AbsenceCategoryRowActions
								category={row.original}
								locale={locale}
								t={t}
								{...actionHandlers}
							/>
						),
					},
				]
			: []),
	];
}

function useAbsenceCategoryMutations(queryKey: QueryKey, onDeleted: () => void) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

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
				onDeleted();
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

	return { toggleActiveMutation, deleteMutation };
}

// eslint-disable-next-line react-doctor/no-giant-component
export function AbsenceCategoriesTable({
	organizationId,
	canManageCategories,
}: AbsenceCategoriesTableProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
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

	const { toggleActiveMutation, deleteMutation } = useAbsenceCategoryMutations(queryKey, () =>
		setCategoryToDelete(null),
	);

	const filteredCategories = filterAbsenceCategories(categories, search, locale, t);

	const columns = buildAbsenceCategoryColumns({
		t,
		locale,
		canManageCategories,
		onEdit: setEditingCategory,
		onToggleActive: toggleActiveMutation.mutate,
		toggleActivePending: toggleActiveMutation.isPending,
		onDelete: setCategoryToDelete,
	});

	const openCreateForm = () => setCreateFormOpen(true);

	const handleFormClose = (open: boolean) => {
		if (!open) {
			setEditingCategory(null);
			setCreateFormOpen(false);
			queryClient.invalidateQueries({ queryKey });
		}
	};

	if (isLoading) {
		return (
			<AbsenceCategoriesLoadingState
				canManageCategories={canManageCategories}
				onCreate={openCreateForm}
				t={t}
			/>
		);
	}

	if (isError) {
		return <AbsenceCategoriesErrorState onRetry={() => refetch()} t={t} />;
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
						<AbsenceCategoriesToolbarActions
							canManageCategories={canManageCategories}
							isFetching={isFetching}
							onCreate={openCreateForm}
							onRefresh={() => refetch()}
							t={t}
						/>
					}
				/>

				<DataTable
					mobileLayout="stacked"
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

			<DeleteAbsenceCategoryDialog
				category={categoryToDelete}
				locale={locale}
				isPending={deleteMutation.isPending}
				onClose={() => setCategoryToDelete(null)}
				onConfirm={(categoryId) => deleteMutation.mutate(categoryId)}
				t={t}
			/>

			<AbsenceCategoryFormDialogs
				canManageCategories={canManageCategories}
				editingCategory={editingCategory}
				createFormOpen={createFormOpen}
				onOpenChange={handleFormClose}
				organizationId={organizationId}
			/>
		</>
	);
}
