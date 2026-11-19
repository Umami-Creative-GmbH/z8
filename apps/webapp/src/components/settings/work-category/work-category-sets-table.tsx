"use client";

import {
	IconEdit,
	IconPlus,
	IconRefresh,
	IconTag,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteWorkCategorySet,
	getWorkCategorySets,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { WorkCategorySetDialog } from "./work-category-set-dialog";

interface WorkCategorySetsTableProps {
	organizationId: string;
	canManage: boolean;
}

interface WorkCategorySetData {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	createdAt: Date;
	categoryCount: number;
}

export function WorkCategorySetsTable({ organizationId, canManage }: WorkCategorySetsTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Dialog states
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedSet, setSelectedSet] = useState<WorkCategorySetData | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	// Fetch category sets
	const {
		data: categorySets,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: queryKeys.workCategorySets.list(organizationId),
		queryFn: async () => {
			const result = await getWorkCategorySets();
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
			} else {
				// The dialog stays open with the reason so the deletion can be retried.
				setDeleteError(
					actionErrorMessage(t, result, {}, [
						"settings.workCategories.setDeleteFailed",
						"Failed to delete category set",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(
				t("settings.workCategories.setDeleteFailed", "Failed to delete category set"),
			);
		},
	});

	const handleEditClick = (set: WorkCategorySetData) => {
		setSelectedSet(set);
		setEditDialogOpen(true);
	};

	const handleDeleteClick = (set: WorkCategorySetData) => {
		setSelectedSet(set);
		setDeleteError(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedSet && !deleteMutation.isPending) {
			setDeleteError(null);
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
					<Table mobileLayout="stacked">
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
			<div className="flex flex-col items-center gap-4 rounded-lg border py-8 text-center">
				<p role="alert" className="text-destructive">
					{t("settings.workCategories.loadError", "Failed to load category sets")}
				</p>
				<Button variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 size-4" aria-hidden="true" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	const sets = categorySets || [];

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="space-y-1.5">
							<CardTitle className="flex items-center gap-2">
								<IconTag className="size-5" aria-hidden="true" />
								{t("settings.workCategories.tab.sets", "Category Sets")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.workCategories.createCategorySetsWithDifferentTimeFactorsForVariousWorkTypes",
									"Create category sets with different time factors for various work types",
								)}
							</CardDescription>
						</div>
						{canManage ? (
							<div className="shrink-0">
								<Button onClick={() => setCreateDialogOpen(true)}>
									<IconPlus className="mr-2 size-4" />
									{t("settings.workCategories.createSet", "Create Set")}
								</Button>
							</div>
						) : null}
					</div>
				</CardHeader>
				<CardContent>
					{sets.length === 0 ? (
						<div className="flex flex-col items-center gap-3 py-8 text-center">
							<div>
								<h3 className="font-medium">
									{t("settings.workCategories.noSets", "No category sets")}
								</h3>
								<p className="mt-1 text-sm text-muted-foreground">
									{t(
										"settings.workCategories.noSetsDescription",
										"Create your first category set to define work types with time factors",
									)}
								</p>
							</div>
							{canManage ? (
								<Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
									<IconPlus className="mr-2 size-4" aria-hidden="true" />
									{t("settings.workCategories.createSet", "Create Set")}
								</Button>
							) : null}
						</div>
					) : (
						<div className="rounded-md border">
							<Table mobileLayout="stacked">
								<TableHeader>
									<TableRow>
										<TableHead>{t("settings.workCategories.setName", "Name")}</TableHead>
										<TableHead>
											{t("settings.workCategories.setDescription", "Description")}
										</TableHead>
										<TableHead>{t("settings.workCategories.categories", "Categories")}</TableHead>
										{canManage ? <TableHead className="w-[100px]" /> : null}
									</TableRow>
								</TableHeader>
								<TableBody>
									{sets.map((set) => (
										<TableRow key={set.id}>
											<TableCell className="max-w-xs font-medium">
												<span className="block truncate" title={set.name}>
													{set.name}
												</span>
											</TableCell>
											<TableCell className="break-words text-muted-foreground">
												{set.description || "-"}
											</TableCell>
											<TableCell>
												<Badge variant="secondary" className="tabular-nums">
													{set.categoryCount}
												</Badge>
											</TableCell>
											{canManage ? (
												<TableCell>
													<div className="flex items-center gap-1">
														<Button
															variant="ghost"
															size="icon"
															className="size-8"
															onClick={() => handleEditClick(set)}
															aria-label={t(
																"settings.workCategories.editSetNamed",
																"Edit category set {name}",
																{ name: set.name },
															)}
														>
															<IconEdit className="size-4" aria-hidden="true" />
														</Button>
														<Button
															variant="ghost"
															size="icon"
															className="size-8 text-muted-foreground hover:text-destructive"
															onClick={() => handleDeleteClick(set)}
															aria-label={t(
																"settings.workCategories.deleteSetNamed",
																"Delete category set {name}",
																{ name: set.name },
															)}
														>
															<IconTrash className="size-4" aria-hidden="true" />
														</Button>
													</div>
												</TableCell>
											) : null}
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Create Dialog */}
			{canManage ? (
				<WorkCategorySetDialog
					open={createDialogOpen}
					onOpenChange={setCreateDialogOpen}
					organizationId={organizationId}
					onSuccess={handleCreateSuccess}
				/>
			) : null}

			{/* Edit Dialog */}
			{canManage ? (
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
			) : null}

			{/* Delete Confirmation Dialog */}
			<DeleteConfirmDialog
				open={canManage && deleteDialogOpen}
				onOpenChange={(open) => {
					setDeleteDialogOpen(open);
					if (!open) setDeleteError(null);
				}}
				title={t("settings.workCategories.deleteSetTitle", "Delete Category Set?")}
				description={t(
					"settings.workCategories.deleteSetDescription",
					'This will permanently delete the category set "{name}" and all its categories. Any assignments using this set will also be removed.',
					{ name: selectedSet?.name },
				)}
				isDeleting={deleteMutation.isPending}
				error={deleteError}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}
