"use client";

import { useCallback, useEffect, useState } from "react";
import { IconPencil, IconPercentage, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	deleteSurchargeAssignment,
	deleteSurchargeModel,
	getSurchargeAssignments,
	getSurchargeModels,
} from "@/app/[locale]/(app)/settings/surcharges/actions";
import type {
	SurchargeAssignmentWithDetails,
	SurchargeModelWithRules,
} from "@/lib/surcharges/validation";
import { SurchargeModelDialog } from "./surcharge-model-dialog";
import { SurchargeAssignmentDialog } from "./surcharge-assignment-dialog";
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

interface SurchargeManagementProps {
	organizationId: string;
}

export function SurchargeManagement({ organizationId }: SurchargeManagementProps) {
	const { t } = useTranslate();
	const [models, setModels] = useState<SurchargeModelWithRules[]>([]);
	const [assignments, setAssignments] = useState<SurchargeAssignmentWithDetails[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [activeTab, setActiveTab] = useState("models");

	// Dialog states
	const [modelDialogOpen, setModelDialogOpen] = useState(false);
	const [editingModel, setEditingModel] = useState<SurchargeModelWithRules | null>(null);
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);

	// Delete confirmation states
	const [deleteModelId, setDeleteModelId] = useState<string | null>(null);
	const [deleteAssignmentId, setDeleteAssignmentId] = useState<string | null>(null);

	const loadData = useCallback(async () => {
		setIsLoading(true);
		try {
			const [modelsResult, assignmentsResult] = await Promise.all([
				getSurchargeModels(organizationId),
				getSurchargeAssignments(organizationId),
			]);

			if (modelsResult.success) {
				setModels(modelsResult.data);
			}
			if (assignmentsResult.success) {
				setAssignments(assignmentsResult.data);
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

	// Delete assignment mutation
	const deleteAssignmentMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteSurchargeAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.surcharges.assignmentDeleted", "Assignment removed"));
				loadData();
			} else {
				toast.error(result.error || t("settings.surcharges.deleteFailed", "Failed to delete"));
			}
			setDeleteAssignmentId(null);
		},
		onError: () => {
			toast.error(t("settings.surcharges.deleteFailed", "Failed to delete assignment"));
			setDeleteAssignmentId(null);
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
		loadData();
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
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-2xl font-bold tracking-tight">
						{t("settings.surcharges.title", "Surcharges")}
					</h2>
					<p className="text-muted-foreground">
						{t(
							"settings.surcharges.description",
							"Configure time surcharges for overtime, night work, weekends, and holidays.",
						)}
					</p>
				</div>
			</div>

			<Tabs value={activeTab} onValueChange={setActiveTab}>
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
												{model.rules.length} {t("settings.surcharges.ruleCount", "rule")}{model.rules.length !== 1 ? "s" : ""}
											</div>
											<div className="space-y-1">
												{model.rules.slice(0, 3).map((rule) => (
													<div
														key={rule.id}
														className="flex items-center justify-between text-sm"
													>
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
														+{model.rules.length - 3} {t("settings.surcharges.moreRules", "more rules")}
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
					<div className="flex justify-end">
						<Button
							onClick={() => setAssignmentDialogOpen(true)}
							disabled={activeModels.length === 0}
						>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.surcharges.createAssignment", "Create Assignment")}
						</Button>
					</div>

					{assignments.length === 0 ? (
						<Card>
							<CardContent className="flex flex-col items-center justify-center py-12">
								<h3 className="mb-2 text-lg font-semibold">
									{t("settings.surcharges.noAssignments", "No assignments")}
								</h3>
								<p className="text-muted-foreground mb-4 text-center">
									{t(
										"settings.surcharges.noAssignmentsDescription",
										"Assign surcharge models to your organization, teams, or individual employees.",
									)}
								</p>
							</CardContent>
						</Card>
					) : (
						<div className="space-y-4">
							{/* Organization-level assignments */}
							<Card>
								<CardHeader>
									<CardTitle className="text-lg">
										{t("settings.surcharges.orgDefault", "Organization Default")}
									</CardTitle>
									<CardDescription>
										{t("settings.surcharges.orgDefaultDesc", "Applied to all employees unless overridden")}
									</CardDescription>
								</CardHeader>
								<CardContent>
									{assignments.filter((a) => a.assignmentType === "organization" && a.isActive)
										.length === 0 ? (
										<p className="text-muted-foreground text-sm">
											{t("settings.surcharges.noOrgAssignment", "No organization-level assignment")}
										</p>
									) : (
										assignments
											.filter((a) => a.assignmentType === "organization" && a.isActive)
											.map((assignment) => (
												<div
													key={assignment.id}
													className="flex items-center justify-between"
												>
													<span>{assignment.model.name}</span>
													<div className="flex items-center gap-2">
														<Badge>Active</Badge>
														<Button
															variant="ghost"
															size="icon"
															className="h-8 w-8 text-destructive hover:text-destructive"
															onClick={() => setDeleteAssignmentId(assignment.id)}
														>
															<IconTrash className="h-4 w-4" />
														</Button>
													</div>
												</div>
											))
									)}
								</CardContent>
							</Card>

							{/* Team-level assignments */}
							<Card>
								<CardHeader>
									<CardTitle className="text-lg">
										{t("settings.surcharges.teamAssignments", "Team Assignments")}
									</CardTitle>
									<CardDescription>
										{t("settings.surcharges.teamAssignmentsDesc", "Override organization default for specific teams")}
									</CardDescription>
								</CardHeader>
								<CardContent>
									{assignments.filter((a) => a.assignmentType === "team" && a.isActive)
										.length === 0 ? (
										<p className="text-muted-foreground text-sm">
											{t("settings.surcharges.noTeamAssignments", "No team assignments")}
										</p>
									) : (
										<div className="space-y-2">
											{assignments
												.filter((a) => a.assignmentType === "team" && a.isActive)
												.map((assignment) => (
													<div
														key={assignment.id}
														className="flex items-center justify-between rounded-md border p-2"
													>
														<div>
															<span className="font-medium">{assignment.team?.name}</span>
															<span className="text-muted-foreground mx-2">→</span>
															<span>{assignment.model.name}</span>
														</div>
														<div className="flex items-center gap-2">
															<Badge variant="outline">Team</Badge>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8 text-destructive hover:text-destructive"
																onClick={() => setDeleteAssignmentId(assignment.id)}
															>
																<IconTrash className="h-4 w-4" />
															</Button>
														</div>
													</div>
												))}
										</div>
									)}
								</CardContent>
							</Card>

							{/* Employee-level assignments */}
							<Card>
								<CardHeader>
									<CardTitle className="text-lg">
										{t("settings.surcharges.individualAssignments", "Individual Assignments")}
									</CardTitle>
									<CardDescription>
										{t("settings.surcharges.individualAssignmentsDesc", "Override for specific employees")}
									</CardDescription>
								</CardHeader>
								<CardContent>
									{assignments.filter((a) => a.assignmentType === "employee" && a.isActive)
										.length === 0 ? (
										<p className="text-muted-foreground text-sm">
											{t("settings.surcharges.noIndividualAssignments", "No individual assignments")}
										</p>
									) : (
										<div className="space-y-2">
											{assignments
												.filter((a) => a.assignmentType === "employee" && a.isActive)
												.map((assignment) => (
													<div
														key={assignment.id}
														className="flex items-center justify-between rounded-md border p-2"
													>
														<div>
															<span className="font-medium">
																{assignment.employee?.firstName}{" "}
																{assignment.employee?.lastName}
															</span>
															<span className="text-muted-foreground mx-2">→</span>
															<span>{assignment.model.name}</span>
														</div>
														<div className="flex items-center gap-2">
															<Badge variant="outline">Individual</Badge>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8 text-destructive hover:text-destructive"
																onClick={() => setDeleteAssignmentId(assignment.id)}
															>
																<IconTrash className="h-4 w-4" />
															</Button>
														</div>
													</div>
												))}
										</div>
									)}
								</CardContent>
							</Card>
						</div>
					)}
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

			{/* Delete Assignment Confirmation */}
			<AlertDialog open={!!deleteAssignmentId} onOpenChange={() => setDeleteAssignmentId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.surcharges.deleteAssignmentTitle", "Remove Assignment?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.surcharges.deleteAssignmentDescription",
								"This will remove this surcharge assignment. The model will remain available.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => deleteAssignmentId && deleteAssignmentMutation.mutate(deleteAssignmentId)}
						>
							{t("common.remove", "Remove")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
