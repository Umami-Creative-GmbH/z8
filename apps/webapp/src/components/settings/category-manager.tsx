"use client";

import { IconAlertCircle, IconLoader2, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	deleteCategory,
	getHolidayCategories,
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

interface HolidayCategory {
	id: string;
	type: string;
	name: string;
	description: string | null;
	color: string | null;
	blocksTimeEntry: boolean;
	excludeFromCalculations: boolean;
	isActive: boolean;
}

interface CategoryManagerProps {
	organizationId: string;
	onAddClick: () => void;
	onEditClick: (category: HolidayCategory) => void;
}

export function CategoryManager({ organizationId, onAddClick, onEditClick }: CategoryManagerProps) {
	const { t } = useTranslate();
	const [categories, setCategories] = useState<HolidayCategory[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [categoryToDelete, setCategoryToDelete] = useState<HolidayCategory | null>(null);

	const fetchCategories = async () => {
		setLoading(true);
		setError(null);

		const result = await getHolidayCategories(organizationId);

		if (result.success && result.data) {
			setCategories(result.data);
		} else {
			setError(result.error || "Failed to load categories");
		}

		setLoading(false);
	};

	useEffect(() => {
		fetchCategories();
	}, [fetchCategories]);

	const handleDeleteClick = (category: HolidayCategory) => {
		setCategoryToDelete(category);
		setDeleteConfirmOpen(true);
	};

	const handleDeleteConfirm = async () => {
		if (!categoryToDelete) return;

		setDeletingId(categoryToDelete.id);
		const result = await deleteCategory(categoryToDelete.id);

		if (result.success) {
			toast.success(t("settings.holidays.categories.deleted", "Category deleted successfully"));
			fetchCategories(); // Refresh the list
		} else {
			toast.error(
				result.error || t("settings.holidays.categories.deleteFailed", "Failed to delete category"),
			);
		}

		setDeletingId(null);
		setDeleteConfirmOpen(false);
		setCategoryToDelete(null);
	};

	const formatCategoryType = (type: string) => {
		const typeMap: Record<string, string> = {
			public_holiday: t("settings.holidays.categories.types.public", "Public Holiday"),
			company_holiday: t("settings.holidays.categories.types.company", "Company Holiday"),
			training_day: t("settings.holidays.categories.types.training", "Training Day"),
			custom: t("settings.holidays.categories.types.custom", "Custom"),
		};
		return typeMap[type] || type;
	};

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">
						{t("settings.holidays.categories.title", "Holiday Categories")}
					</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.categories.add", "Add Category")}
					</Button>
				</div>
				<div className="rounded-md border p-8 flex items-center justify-center">
					<div className="flex items-center gap-2 text-muted-foreground">
						<IconLoader2 className="h-5 w-5 animate-spin" />
						<span>{t("settings.holidays.categories.loading", "Loading categories...")}</span>
					</div>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">
						{t("settings.holidays.categories.title", "Holiday Categories")}
					</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.categories.add", "Add Category")}
					</Button>
				</div>
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-4">
					<div className="flex items-center gap-2 text-destructive">
						<IconAlertCircle className="h-5 w-5" />
						<span>{error}</span>
					</div>
					<Button onClick={fetchCategories} variant="outline" size="sm">
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
					<h3 className="text-lg font-medium">
						{t("settings.holidays.categories.title", "Holiday Categories")}
					</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.categories.add", "Add Category")}
					</Button>
				</div>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.holidays.categories.name", "Name")}</TableHead>
								<TableHead>{t("settings.holidays.categories.type", "Type")}</TableHead>
								<TableHead>{t("settings.holidays.categories.color", "Color")}</TableHead>
								<TableHead>{t("settings.holidays.categories.settings", "Settings")}</TableHead>
								<TableHead className="text-right">
									{t("settings.holidays.categories.actions", "Actions")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{categories.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-muted-foreground h-24">
										{t(
											"settings.holidays.categories.empty",
											"No categories found. Add your first category to get started.",
										)}
									</TableCell>
								</TableRow>
							) : (
								categories.map((category) => (
									<TableRow key={category.id}>
										<TableCell>
											<div>
												<div className="font-medium">{category.name}</div>
												{category.description && (
													<div className="text-sm text-muted-foreground">
														{category.description}
													</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<Badge variant="outline">{formatCategoryType(category.type)}</Badge>
										</TableCell>
										<TableCell>
											{category.color ? (
												<div className="flex items-center gap-2">
													<div
														className="h-4 w-4 rounded-full border"
														style={{ backgroundColor: category.color }}
													/>
													<span className="text-sm text-muted-foreground">{category.color}</span>
												</div>
											) : (
												<span className="text-sm text-muted-foreground">
													{t("settings.holidays.categories.noColor", "No color")}
												</span>
											)}
										</TableCell>
										<TableCell>
											<div className="flex gap-2">
												{category.blocksTimeEntry && (
													<Badge variant="secondary" className="text-xs">
														{t("settings.holidays.categories.blocks", "Blocks Time Entry")}
													</Badge>
												)}
												{category.excludeFromCalculations && (
													<Badge variant="secondary" className="text-xs">
														{t("settings.holidays.categories.excludes", "Excludes from Calc")}
													</Badge>
												)}
											</div>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => onEditClick(category)}
													disabled={deletingId === category.id}
												>
													<IconPencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDeleteClick(category)}
													disabled={deletingId === category.id}
												>
													{deletingId === category.id ? (
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

			<AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.categories.delete.title", "Delete Category")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.categories.delete.description",
								'Are you sure you want to delete "{name}"? This action cannot be undone. Categories in use by holidays cannot be deleted.',
								{ name: categoryToDelete?.name || "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
