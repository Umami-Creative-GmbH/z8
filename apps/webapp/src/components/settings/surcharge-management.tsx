"use client";

import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import {
	deleteSurchargeModel,
	getSurchargeModels,
} from "@/app/[locale]/(app)/settings/surcharges/actions";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import type { SurchargeModelWithRules } from "@/lib/surcharges/validation";
import { SurchargeAssignmentDialog } from "./surcharge-assignment-dialog";
import { SurchargeAssignmentManager } from "./surcharge-assignment-manager";
import { SurchargeModelDialog } from "./surcharge-model-dialog";
import { SurchargeModelList } from "./surcharge-model-list";
import { SurchargeReports } from "./surcharge-reports/surcharge-reports-root";

interface SurchargeManagementProps {
	organizationId: string;
	canManage: boolean;
}

export function SurchargeManagement({
	organizationId,
	canManage,
}: SurchargeManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [models, setModels] = useState<SurchargeModelWithRules[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [activeTab, setActiveTab] = useState("models");

	// Dialog states
	const [modelDialogOpen, setModelDialogOpen] = useState(false);
	const [editingModel, setEditingModel] =
		useState<SurchargeModelWithRules | null>(null);
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<
		"organization" | "team" | "employee"
	>("organization");

	// Delete confirmation states
	const [deleteModelId, setDeleteModelId] = useState<string | null>(null);

	const loadData = async () => {
		setIsLoading(true);

		const modelsResult = await getSurchargeModels(organizationId).catch(
			(error: unknown) => {
				console.error("Failed to load surcharge data:", error);
				return null;
			},
		);

		if (modelsResult?.success) {
			setModels(modelsResult.data);
		}

		setIsLoading(false);
	};

	const loadDataForEffect = useEffectEvent(async () => {
		await loadData();
	});

	useEffect(() => {
		const timeout = setTimeout(() => loadDataForEffect(), 0);
		return () => clearTimeout(timeout);
	}, []);

	// Delete model mutation
	const deleteModelMutation = useMutation({
		mutationFn: (modelId: string) => deleteSurchargeModel(modelId),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.surcharges.models.list(organizationId),
				});
				toast.success(
					t("settings.surcharges.modelDeleted", "Surcharge model deleted"),
				);
				loadData();
			} else {
				toast.error(
					result.error ||
						t("settings.surcharges.deleteFailed", "Failed to delete"),
				);
			}
			setDeleteModelId(null);
		},
		onError: () => {
			toast.error(
				t("settings.surcharges.deleteFailed", "Failed to delete model"),
			);
			setDeleteModelId(null);
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
		loadData();
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

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="text-muted-foreground">
					{t("settings.surcharges.loading", "Loading surcharge settings...")}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold">
					{t("settings.surcharges.title", "Surcharges")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.surcharges.description",
						"Configure time surcharges for overtime, night work, weekends, and holidays.",
					)}
				</p>
			</div>

			<Tabs
				value={activeTab}
				onValueChange={setActiveTab}
				className="space-y-4"
			>
				<TabsList>
					<TabsTrigger value="models">
						{t("settings.surcharges.tabModels", "Models")}
					</TabsTrigger>
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
					<SurchargeReports organizationId={organizationId} />
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
			<AlertDialog
				open={canManage && !!deleteModelId}
				onOpenChange={() => setDeleteModelId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"settings.surcharges.deleteModelTitle",
								"Delete Surcharge Model?",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.surcharges.deleteModelDescription",
								"This will deactivate the model and all its assignments. This action cannot be undone.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() =>
								deleteModelId && deleteModelMutation.mutate(deleteModelId)
							}
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
