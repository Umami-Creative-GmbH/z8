"use client";

import { IconEdit, IconLoader2, IconPlus, IconTag, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteWorkCategorySet,
	getWorkCategorySets,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query";
import { WorkCategorySetDialog } from "./work-category-set-dialog";

interface WorkCategorySetsTableProps {
	organizationId: string;
}

interface WorkCategorySetData {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	createdAt: Date;
	categoryCount: number;
}

export function WorkCategorySetsTable({ organizationId }: WorkCategorySetsTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Dialog states
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedSet, setSelectedSet] = useState<WorkCategorySetData | null>(null);

	// Fetch category sets
	const {
		data: categorySets,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.workCategorySets.list(organizationId),
		queryFn: async () => {
			const result = await getWorkCategorySets(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch category sets");
			}
			return result.data as WorkCategorySetData[];
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (setId: string) => deleteWorkCategorySet(setId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workCategories.setDeleted", "Category set deleted"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategorySets.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedSet(null);
			} else {
				toast.error(
					result.error ||
						t("settings.workCategories.setDeleteFailed", "Failed to delete category set"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workCategories.setDeleteFailed", "Failed to delete category set"));
		},
	});

	const handleEditClick = (set: WorkCategorySetData) => {
		setSelectedSet(set);
		setEditDialogOpen(true);
	};

	const handleDeleteClick = (set: WorkCategorySetData) => {
		setSelectedSet(set);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedSet) {
			deleteMutation.mutate(selectedSet.id);
		}
	};

	const handleCreateSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workCategorySets.list(organizationId),
		});
		setCreateDialogOpen(false);
	};

	const handleEditSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workCategorySets.list(organizationId),
		});
		setEditDialogOpen(false);
		setSelectedSet(null);
	};

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-end">
					<Skeleton className="h-9 w-32" />
				</div>
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									<Skeleton className="h-4 w-24" />
								</TableHead>
								<TableHead>
									<Skeleton className="h-4 w-32" />
								</TableHead>
								<TableHead>
									<Skeleton className="h-4 w-20" />
								</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{[1, 2, 3].map((i) => (
								<TableRow key={i}>
									<TableCell>
										<Skeleton className="h-4 w-32" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-48" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-6 w-12" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-8 w-20" />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="py-8 text-center">
				<p className="text-destructive">
					{t("settings.workCategories.loadError", "Failed to load category sets")}
				</p>
			</div>
		);
	}

	const sets = categorySets || [];

	return (
		<>
			<div className="space-y-4">
				<div className="flex justify-end">
					<Button onClick={() => setCreateDialogOpen(true)}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.workCategories.createSet", "Create Set")}
					</Button>
				</div>

				{sets.length === 0 ? (
					<div className="py-12 text-center">
						<IconTag className="mx-auto h-12 w-12 text-muted-foreground/50" />
						<h3 className="mt-4 text-lg font-medium">
							{t("settings.workCategories.noSets", "No category sets")}
						</h3>
						<p className="mt-2 text-sm text-muted-foreground">
							{t(
								"settings.workCategories.noSetsDescription",
								"Create your first category set to define work types with time factors",
							)}
						</p>
						<Button className="mt-4" onClick={() => setCreateDialogOpen(true)}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.workCategories.createFirstSet", "Create First Set")}
						</Button>
					</div>
				) : (
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.workCategories.setName", "Name")}</TableHead>
									<TableHead>
										{t("settings.workCategories.setDescription", "Description")}
									</TableHead>
									<TableHead>{t("settings.workCategories.categories", "Categories")}</TableHead>
									<TableHead className="w-[100px]" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{sets.map((set) => (
									<TableRow key={set.id}>
										<TableCell className="font-medium">{set.name}</TableCell>
										<TableCell className="text-muted-foreground">
											{set.description || "-"}
										</TableCell>
										<TableCell>
											<Badge variant="secondary">{set.categoryCount}</Badge>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-1">
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8"
													onClick={() => handleEditClick(set)}
													aria-label={t("common.edit", "Edit")}
												>
													<IconEdit className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeleteClick(set)}
													aria-label={t("common.delete", "Delete")}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</div>

			{/* Create Dialog */}
			<WorkCategorySetDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				organizationId={organizationId}
				onSuccess={handleCreateSuccess}
			/>

			{/* Edit Dialog */}
			<WorkCategorySetDialog
				open={editDialogOpen}
				onOpenChange={(open) => {
					setEditDialogOpen(open);
					if (!open) setSelectedSet(null);
				}}
				organizationId={organizationId}
				categorySet={selectedSet}
				onSuccess={handleEditSuccess}
			/>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.workCategories.deleteSetTitle", "Delete Category Set?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.workCategories.deleteSetDescription",
								'This will permanently delete the category set "{name}" and all its categories. Any assignments using this set will also be removed.',
								{ name: selectedSet?.name },
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
							className="bg-destructive hover:bg-destructive/90"
						>
							{deleteMutation.isPending ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("common.deleting", "Deleting...")}
								</>
							) : (
								t("common.delete", "Delete")
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
