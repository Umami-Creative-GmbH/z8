"use client";

import { IconPencil, IconPercentage, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import type { SurchargeModelWithRules } from "@/lib/surcharges/validation";
import { SurchargeAssignmentDialog } from "./surcharge-assignment-dialog";
import { SurchargeAssignmentManager } from "./surcharge-assignment-manager";
import { SurchargeModelDialog } from "./surcharge-model-dialog";

interface SurchargeManagementProps {
	organizationId: string;
}

export function SurchargeManagement({ organizationId }: SurchargeManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [models, setModels] = useState<SurchargeModelWithRules[]>([]);
	const [isLoading, setIsLoading] = useState(true);
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

	const loadData = useCallback(async () => {
		setIsLoading(true);
		try {
			const modelsResult = await getSurchargeModels(organizationId);

			if (modelsResult.success) {
				setModels(modelsResult.data);
			}
		} catch (error) {
			console.error("Failed to load surcharge data:", error);
		} finally {
			setIsLoading(false);
		}
	}, [organizationId]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	// Delete model mutation
	const deleteModelMutation = useMutation({
		mutationFn: (modelId: string) => deleteSurchargeModel(modelId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.surcharges.modelDeleted", "Surcharge model deleted"));
				loadData();
			} else {
				toast.error(result.error || t("settings.surcharges.deleteFailed", "Failed to delete"));
			}
			setDeleteModelId(null);
		},
		onError: () => {
			toast.error(t("settings.surcharges.deleteFailed", "Failed to delete model"));
			setDeleteModelId(null);
		},
	});

	const formatPercentage = (percentage: string) => {
		const value = parseFloat(percentage) * 100;
		return `${value}%`;
	};

	const getRuleTypeLabel = (ruleType: string) => {
		switch (ruleType) {
			case "day_of_week":
				return t("settings.surcharges.dayOfWeek", "Day of Week");
			case "time_window":
				return t("settings.surcharges.timeWindow", "Time Window");
			case "date_based":
				return t("settings.surcharges.dateBased", "Date-Based");
			default:
				return ruleType;
		}
	};

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

	const activeModels = models.filter((m) => m.isActive);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold">{t("settings.surcharges.title", "Surcharges")}</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.surcharges.description",
						"Configure time surcharges for overtime, night work, weekends, and holidays.",
					)}
				</p>
			</div>

			<Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
					<div className="flex justify-end">
						<Button onClick={handleCreateModel}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.surcharges.createModel", "Create Model")}
						</Button>
					</div>

					{models.length === 0 ? (
						<Card>
							<CardContent className="flex flex-col items-center justify-center py-12">
								<IconPercentage className="text-muted-foreground mb-4 h-12 w-12" />
								<h3 className="mb-2 text-lg font-semibold">
									{t("settings.surcharges.noModels", "No surcharge models")}
								</h3>
								<p className="text-muted-foreground mb-4 text-center">
									{t(
										"settings.surcharges.noModelsDescription",
										"Create a surcharge model to define rules for overtime, night work, and weekend premiums.",
									)}
								</p>
								<Button onClick={handleCreateModel}>
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.surcharges.createFirstModel", "Create First Model")}
								</Button>
							</CardContent>
						</Card>
					) : (
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							{activeModels.map((model) => (
								<Card key={model.id} className="relative">
									<CardHeader>
										<div className="flex items-start justify-between">
											<div className="flex-1 min-w-0">
												<CardTitle className="text-lg truncate">{model.name}</CardTitle>
												{model.description && (
													<CardDescription className="mt-1 line-clamp-2">
														{model.description}
													</CardDescription>
												)}
											</div>
											<div className="flex items-center gap-1 ml-2">
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8"
													onClick={() => handleEditModel(model)}
												>
													<IconPencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-destructive hover:text-destructive"
													onClick={() => setDeleteModelId(model.id)}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										</div>
									</CardHeader>
									<CardContent>
										<div className="space-y-2">
											<div className="text-muted-foreground text-sm">
												{t(
													"settings.surcharges.ruleCountLabel",
													"{count, plural, one {# rule} other {# rules}}",
													{ count: model.rules.length },
												)}
											</div>
											<div className="space-y-1">
												{model.rules.slice(0, 3).map((rule) => (
													<div key={rule.id} className="flex items-center justify-between text-sm">
														<span className="truncate mr-2">{rule.name}</span>
														<div className="flex items-center gap-2 flex-shrink-0">
															<Badge variant="outline" className="text-xs">
																{getRuleTypeLabel(rule.ruleType)}
															</Badge>
															<span className="font-medium text-green-600">
																+{formatPercentage(rule.percentage)}
															</span>
														</div>
													</div>
												))}
												{model.rules.length > 3 && (
													<div className="text-muted-foreground text-xs">
														+{model.rules.length - 3}{" "}
														{t("settings.surcharges.moreRules", "more rules")}
													</div>
												)}
											</div>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<SurchargeAssignmentManager
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>

				<TabsContent value="reports" className="space-y-4">
					<Card>
						<CardContent className="flex flex-col items-center justify-center py-12">
							<h3 className="mb-2 text-lg font-semibold">
								{t("settings.surcharges.reports", "Surcharge Reports")}
							</h3>
							<p className="text-muted-foreground text-center">
								{t(
									"settings.surcharges.reportsDescription",
									"View surcharge calculations and summaries for your employees.",
								)}
								<br />
								{t("settings.surcharges.comingSoon", "Coming soon...")}
							</p>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Model Dialog */}
			<SurchargeModelDialog
				open={modelDialogOpen}
				onOpenChange={setModelDialogOpen}
				organizationId={organizationId}
				editingModel={editingModel}
				onSuccess={handleModelDialogSuccess}
			/>

			{/* Assignment Dialog */}
			<SurchargeAssignmentDialog
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentDialogSuccess}
			/>

			{/* Delete Model Confirmation */}
			<AlertDialog open={!!deleteModelId} onOpenChange={() => setDeleteModelId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.surcharges.deleteModelTitle", "Delete Surcharge Model?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.surcharges.deleteModelDescription",
								"This will deactivate the model and all its assignments. This action cannot be undone.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => deleteModelId && deleteModelMutation.mutate(deleteModelId)}
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
