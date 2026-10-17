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
import type { useTranslate } from "@tolgee/react";
import { DataTableSkeleton } from "@/components/data-table-server";
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
import {
	getAbsenceCategoryDisplayDescription,
	getAbsenceCategoryDisplayName,
} from "@/lib/absences/category-display";
import { AbsenceCategoryForm } from "./absence-category-form";
import type { AbsenceCategoryForSettings } from "./absence-category-form-utils";

type Translate = ReturnType<typeof useTranslate>["t"];

export function AbsenceCategoryNameCell({
	category,
	locale,
	t,
}: {
	category: AbsenceCategoryForSettings;
	locale: string;
	t: Translate;
}) {
	const displayName = getAbsenceCategoryDisplayName(category, locale, t);
	const displayDescription = getAbsenceCategoryDisplayDescription(category, locale, t);

	return (
		<div className="flex items-center gap-2">
			{category.color ? (
				<span
					className="size-3 shrink-0 rounded-full border"
					style={{ backgroundColor: category.color }}
					title={t("settings.absenceCategories.colorIndicator", "Category color")}
				/>
			) : null}
			<div className="min-w-0">
				<div className="font-medium">{displayName}</div>
				{displayDescription ? (
					<div className="wrap-break-word text-muted-foreground text-sm">{displayDescription}</div>
				) : null}
			</div>
		</div>
	);
}

export function AbsenceCategoryVacationBalanceCell({
	category,
	t,
}: {
	category: AbsenceCategoryForSettings;
	t: Translate;
}) {
	if (category.countsAgainstVacation) {
		return (
			<Badge variant="outline">
				{t("settings.absenceCategories.countsAgainstVacation", "Deducts balance")}
			</Badge>
		);
	}
	if (category.drawsOnWorkBalance) {
		return (
			<Badge variant="outline">
				{t("settings.absenceCategories.drawsOnWorkBalance", "Draws on work balance")}
			</Badge>
		);
	}
	return (
		<span className="text-muted-foreground text-sm">
			{t("settings.absenceCategories.noVacationDeduction", "No deduction")}
		</span>
	);
}

export interface AbsenceCategoryRowActionHandlers {
	onEdit: (category: AbsenceCategoryForSettings) => void;
	onToggleActive: (category: AbsenceCategoryForSettings) => void;
	toggleActivePending: boolean;
	onDelete: (category: AbsenceCategoryForSettings) => void;
}

export function AbsenceCategoryRowActions({
	category,
	locale,
	t,
	onEdit,
	onToggleActive,
	toggleActivePending,
	onDelete,
}: AbsenceCategoryRowActionHandlers & {
	category: AbsenceCategoryForSettings;
	locale: string;
	t: Translate;
}) {
	const displayName = getAbsenceCategoryDisplayName(category, locale, t);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={`${t("common.openMenu", "Open menu")} ${displayName}`}
				>
					<IconDots aria-hidden="true" className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => onEdit(category)}>
					<IconPencil aria-hidden="true" className="mr-2 size-4" />
					{t("common.edit", "Edit")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onToggleActive(category)} disabled={toggleActivePending}>
					{category.isActive ? (
						<IconX aria-hidden="true" className="mr-2 size-4" />
					) : (
						<IconCheck aria-hidden="true" className="mr-2 size-4" />
					)}
					{category.isActive
						? t("settings.absenceCategories.deactivate", "Deactivate")
						: t("settings.absenceCategories.reactivate", "Reactivate")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem className="text-destructive" onClick={() => onDelete(category)}>
					<IconTrash aria-hidden="true" className="mr-2 size-4" />
					{t("common.delete", "Delete")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function AddAbsenceCategoryButton({ onClick, t }: { onClick: () => void; t: Translate }) {
	return (
		<Button onClick={onClick}>
			<IconPlus aria-hidden="true" className="mr-2 size-4" />
			{t("settings.absenceCategories.addCategory", "Add category")}
		</Button>
	);
}

export function AbsenceCategoriesLoadingState({
	canManageCategories,
	onCreate,
	t,
}: {
	canManageCategories: boolean;
	onCreate: () => void;
	t: Translate;
}) {
	return (
		<div className="space-y-4">
			{canManageCategories ? (
				<div className="flex justify-end">
					<AddAbsenceCategoryButton onClick={onCreate} t={t} />
				</div>
			) : null}
			<DataTableSkeleton columnCount={canManageCategories ? 6 : 5} rowCount={5} />
		</div>
	);
}

export function AbsenceCategoriesErrorState({ onRetry, t }: { onRetry: () => void; t: Translate }) {
	return (
		<div className="flex flex-col items-center justify-center rounded-lg border py-12 text-center">
			<p className="text-destructive">
				{t("settings.absenceCategories.loadError", "Failed to load absence categories")}
			</p>
			<Button className="mt-4" variant="outline" onClick={onRetry}>
				<IconRefresh aria-hidden="true" className="mr-2 size-4" />
				{t("common.retry", "Retry")}
			</Button>
		</div>
	);
}

export function AbsenceCategoriesToolbarActions({
	canManageCategories,
	isFetching,
	onCreate,
	onRefresh,
	t,
}: {
	canManageCategories: boolean;
	isFetching: boolean;
	onCreate: () => void;
	onRefresh: () => void;
	t: Translate;
}) {
	return (
		<div className="flex items-center gap-2">
			<Button variant="ghost" size="icon" onClick={onRefresh} disabled={isFetching}>
				{isFetching ? (
					<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
				) : (
					<IconRefresh aria-hidden="true" className="size-4" />
				)}
				<span className="sr-only">{t("common.refresh", "Refresh")}</span>
			</Button>
			{canManageCategories ? <AddAbsenceCategoryButton onClick={onCreate} t={t} /> : null}
		</div>
	);
}

export function DeleteAbsenceCategoryDialog({
	category,
	locale,
	isPending,
	onClose,
	onConfirm,
	t,
}: {
	category: AbsenceCategoryForSettings | null;
	locale: string;
	isPending: boolean;
	onClose: () => void;
	onConfirm: (categoryId: string) => void;
	t: Translate;
}) {
	const categoryName = category ? getAbsenceCategoryDisplayName(category, locale, t) : undefined;

	return (
		<AlertDialog open={!!category} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.absenceCategories.deleteTitle", "Delete Absence Category")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.absenceCategories.deleteDescription",
							'Are you sure you want to delete "{name}"? Categories used by existing absences cannot be deleted and should be deactivated instead.',
							{ name: categoryName },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							if (category) {
								onConfirm(category.id);
							}
						}}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						disabled={isPending}
					>
						{isPending ? (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						) : null}
						{t("common.delete", "Delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function AbsenceCategoryFormDialogs({
	canManageCategories,
	editingCategory,
	createFormOpen,
	onOpenChange,
	organizationId,
}: {
	canManageCategories: boolean;
	editingCategory: AbsenceCategoryForSettings | null;
	createFormOpen: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
}) {
	if (!canManageCategories) return null;

	return (
		<>
			{editingCategory ? (
				<AbsenceCategoryForm
					key={`edit-${editingCategory.id}`}
					open={!!editingCategory}
					onOpenChange={onOpenChange}
					organizationId={organizationId}
					existingCategory={editingCategory}
				/>
			) : null}

			{createFormOpen ? (
				<AbsenceCategoryForm
					key="create"
					open={createFormOpen}
					onOpenChange={onOpenChange}
					organizationId={organizationId}
				/>
			) : null}
		</>
	);
}
