"use client";

import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteSurchargeModel } from "@/app/[locale]/(app)/settings/surcharges/actions";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { surchargeModelsQuery } from "@/lib/query/surcharge-models";
import type { SurchargeModelWithRules } from "@/lib/surcharges/validation";
import { SettingsLoadError } from "./settings-load-error";
import { SurchargeAssignmentDialog } from "./surcharge-assignment-dialog";
import { SurchargeAssignmentManager } from "./surcharge-assignment-manager";
import { SurchargeModelDialog } from "./surcharge-model-dialog";
import { SurchargeModelList } from "./surcharge-model-list";
import { SurchargeReports } from "./surcharge-reports/surcharge-reports-root";

interface SurchargeManagementProps {
	organizationId: string;
	canManage: boolean;
	organizationTimezone?: string;
}

export function SurchargeManagement({
	organizationId,
	canManage,
	organizationTimezone = "UTC",
}: SurchargeManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const modelsQuery = useQuery(surchargeModelsQuery(organizationId));
	const models = modelsQuery.data ?? [];
	const isLoading = modelsQuery.isPending;
	const [activeTab, setActiveTab] = useState("models");

	// Dialog states
	const [modelDialogOpen, setModelDialogOpen] = useState(false);
	const [editingModel, setEditingModel] = useState<SurchargeModelWithRules | null>(null);
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<"organization" | "team" | "employee">(
		"organization",
	);

	// Delete confirmation states
	const [deleteModelId, setDeleteModelId] = useState<string | null>(null);
	const [deleteModelError, setDeleteModelError] = useState<string | null>(null);

	// Delete model mutation
	const deleteModelMutation = useMutation({
		mutationFn: (modelId: string) => deleteSurchargeModel(modelId),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.surcharges.models.list(organizationId),
				});
				toast.success(t("settings.surcharges.modelDeleted", "Surcharge model deleted"));
				setDeleteModelId(null);
			} else {
				// The dialog stays open with the reason so the deletion can be retried.
				setDeleteModelError(
					actionErrorMessage(t, result, {}, [
						"settings.surcharges.deleteFailed",
						"Failed to delete",
					]),
				);
			}
		},
		onError: () => {
			setDeleteModelError(t("settings.surcharges.deleteFailed", "Failed to delete model"));
		},
	});

	const handleCreateModel = () => {
		setEditingModel(null);
		setModelDialogOpen(true);
	};

	const handleEditModel = (model: SurchargeModelWithRules) => {
		setEditingModel(model);
		setModelDialogOpen(true);
	};

	const handleModelDialogSuccess = () => {
		setModelDialogOpen(false);
		setEditingModel(null);
	};

	const handleAssignmentDialogSuccess = () => {
		setAssignmentDialogOpen(false);
		// Invalidate assignments query to refresh the list
		queryClient.invalidateQueries({
			queryKey: queryKeys.surcharges.assignments.list(organizationId),
		});
	};

	const handleAssignClick = (type: "organization" | "team" | "employee") => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	};
	const pageHeader = (
		<PageHeader
			title={t("settings.surcharges.title", "Surcharges")}
			description={t(
				"settings.surcharges.description",
				"Configure time surcharges for overtime, night work, weekends, and holidays.",
			)}
		/>
	);
	const modelError = (
		<SettingsLoadError
			message={t(
				"settings.surcharges.loadFailed",
				"Surcharge models could not be loaded. Please try again.",
			)}
			retryLabel={t("common.retry", "Try again")}
			onRetry={() => void modelsQuery.refetch()}
			isRetrying={modelsQuery.isFetching}
		/>
	);
	const deleteModelName = models.find((model) => model.id === deleteModelId)?.name ?? "";

	if (isLoading) {
		return (
			<LoadingRegion
				className="page-frame flex flex-1 flex-col gap-6"
				label={{
					labelKey: "settings.surcharges.loading",
					labelDefault: "Loading surcharge settings...",
				}}
			>
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
				</div>
				<Skeleton aria-hidden="true" className="h-9 w-72 max-w-full" />
				<Skeleton aria-hidden="true" className="h-64 w-full" />
			</LoadingRegion>
		);
	}
	if (modelsQuery.isError && !modelsQuery.data) {
		return (
			<div className="page-frame flex flex-1 flex-col gap-6">
				{pageHeader}
				{modelError}
			</div>
		);
	}

	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			{pageHeader}
			{modelsQuery.isError ? modelError : null}

			<Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 gap-4">
				<TabsList>
					<TabsTrigger value="models">{t("settings.surcharges.tabModels", "Models")}</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.surcharges.tabAssignments", "Assignments")}
					</TabsTrigger>
					<TabsTrigger value="reports">
						{t("settings.surcharges.tabReports", "Reports")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="models" className="space-y-4">
					{canManage ? (
						<div className="flex justify-end">
							<Button onClick={handleCreateModel}>
								<IconPlus className="mr-2 size-4" />
								{t("settings.surcharges.createModel", "Create Model")}
							</Button>
						</div>
					) : null}

					<SurchargeModelList
						canManage={canManage}
						models={models}
						onCreate={handleCreateModel}
						onDelete={setDeleteModelId}
						onEdit={handleEditModel}
					/>
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<SurchargeAssignmentManager
						canManage={canManage}
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>

				<TabsContent value="reports" className="space-y-4">
					<SurchargeReports
						organizationId={organizationId}
						organizationTimezone={organizationTimezone}
					/>
				</TabsContent>
			</Tabs>

			{/* Model Dialog */}
			{canManage ? (
				<SurchargeModelDialog
					open={modelDialogOpen}
					onOpenChange={setModelDialogOpen}
					organizationId={organizationId}
					editingModel={editingModel}
					onSuccess={handleModelDialogSuccess}
				/>
			) : null}

			{/* Assignment Dialog */}
			{canManage ? (
				<SurchargeAssignmentDialog
					open={assignmentDialogOpen}
					onOpenChange={setAssignmentDialogOpen}
					organizationId={organizationId}
					assignmentType={assignmentType}
					onSuccess={handleAssignmentDialogSuccess}
				/>
			) : null}

			{/* Delete Model Confirmation */}
			<DeleteConfirmDialog
				open={canManage && !!deleteModelId}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteModelId(null);
						setDeleteModelError(null);
					}
				}}
				title={t("settings.surcharges.deleteModelTitle", "Delete Surcharge Model?")}
				description={
					<>
						{deleteModelName ? (
							<span className="mb-2 block font-medium text-foreground break-words">
								{deleteModelName}
							</span>
						) : null}
						{t(
							"settings.surcharges.deleteModelDescription",
							"This will deactivate the model and all its assignments. This action cannot be undone.",
						)}
					</>
				}
				isDeleting={deleteModelMutation.isPending}
				error={deleteModelError}
				onConfirm={() => {
					if (!deleteModelId || deleteModelMutation.isPending) return;
					setDeleteModelError(null);
					deleteModelMutation.mutate(deleteModelId);
				}}
			/>
		</div>
	);
}
