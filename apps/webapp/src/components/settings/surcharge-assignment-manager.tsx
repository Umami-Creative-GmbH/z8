"use client";

import {
	IconBuilding,
	IconPercentage,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteSurchargeAssignment,
	getSurchargeAssignments,
} from "@/app/[locale]/(app)/settings/surcharges/actions";
import { AssignmentLevelCardHeader } from "@/components/settings/assignment-level-card-header";
import { AssignmentManagerSkeleton } from "@/components/settings/assignment-manager-skeleton";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { SettingsLoadError } from "./settings-load-error";
import {
	type SurchargeAssignmentData,
	SurchargeEmployeeAssignmentsCard,
	SurchargeTeamAssignmentsCard,
} from "./surcharge-assignment-cards";

interface SurchargeAssignmentManagerProps {
	canManage: boolean;
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

export function SurchargeAssignmentManager({
	canManage,
	organizationId,
	onAssignClick,
}: SurchargeAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<SurchargeAssignmentData | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: queryKeys.surcharges.assignments.list(organizationId),
		queryFn: async () => {
			const result = await getSurchargeAssignments();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			// Filter only active assignments
			return (result.data as SurchargeAssignmentData[]).filter(
				(a) => a.isActive,
			);
		},
	});

	// Delete assignment mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) =>
			deleteSurchargeAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.surcharges.assignmentDeleted", "Assignment removed"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.surcharges.assignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
			} else {
				// The dialog stays open with the reason so the removal can be retried.
				setDeleteError(
					actionErrorMessage(t, result, {}, [
						"settings.surcharges.assignmentDeleteFailed",
						"Failed to remove assignment",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(
				t(
					"settings.surcharges.assignmentDeleteFailed",
					"Failed to remove assignment",
				),
			);
		},
	});

	const handleDeleteClick = (assignment: SurchargeAssignmentData) => {
		setSelectedAssignment(assignment);
		setDeleteError(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignment && !deleteMutation.isPending) {
			setDeleteError(null);
			deleteMutation.mutate(selectedAssignment.id);
		}
	};

	// Group assignments by type
	const allAssignments = assignments || [];
	const orgAssignment = allAssignments.find(
		(a) => a.assignmentType === "organization",
	);
	const teamAssignments = allAssignments.filter(
		(a) => a.assignmentType === "team",
	);
	const employeeAssignments = allAssignments.filter(
		(a) => a.assignmentType === "employee",
	);

	if (isLoading) {
		return <AssignmentManagerSkeleton />;
	}

	if (error) {
		return (
			<SettingsLoadError
				message={t("settings.surcharges.loadError", "Failed to load assignments")}
				onRetry={() => void refetch()}
				isRetrying={isFetching}
			/>
		);
	}

	return (
		<>
			<div className="space-y-6">
				{/* Organization Level */}
				<Card>
					<AssignmentLevelCardHeader
						icon={IconBuilding}
						title={t("settings.surcharges.orgLevel", "Organization Level")}
						description={t(
							"settings.surcharges.orgLevelDescription",
							"Default surcharge model applied to all employees unless overridden",
						)}
					/>
					<CardContent>
						<div className="flex items-center justify-between mb-2">
							<h4 className="text-sm font-medium text-muted-foreground">
								{t("settings.surcharges.defaultModel", "Default Model")}
							</h4>
							{canManage && !orgAssignment && (
								<Button
									onClick={() => onAssignClick("organization")}
									size="sm"
									variant="outline"
								>
									<IconPlus className="mr-2 size-4" />
									{t("settings.surcharges.setDefault", "Set Default")}
								</Button>
							)}
						</div>
						{orgAssignment ? (
							<div className="flex items-center justify-between gap-2 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
								<div className="flex min-w-0 items-center gap-3">
									<IconPercentage
										aria-hidden="true"
										className="size-4 shrink-0 text-muted-foreground"
									/>
									<span
										className="min-w-0 truncate font-medium"
										title={orgAssignment.model.name}
									>
										{orgAssignment.model.name}
									</span>
								</div>
								{canManage ? (
									<Button
										aria-label={`${t(
											"settings.surcharges.removeOrganizationAssignment",
											"Remove organization assignment",
										)}: ${orgAssignment.model.name}`}
										variant="ghost"
										size="icon"
										className="size-8 text-muted-foreground hover:text-destructive"
										onClick={() => handleDeleteClick(orgAssignment)}
									>
										<IconTrash className="size-4" />
									</Button>
								) : null}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-2 border rounded-lg bg-muted/30">
								{t(
									"settings.surcharges.noOrgDefault",
									"No default surcharge model set",
								)}
							</p>
						)}
					</CardContent>
				</Card>

				<SurchargeTeamAssignmentsCard
					assignments={teamAssignments}
					canManage={canManage}
					onAssign={() => onAssignClick("team")}
					onDelete={handleDeleteClick}
				/>

				<SurchargeEmployeeAssignmentsCard
					assignments={employeeAssignments}
					canManage={canManage}
					onAssign={() => onAssignClick("employee")}
					onDelete={handleDeleteClick}
				/>
			</div>

			{/* Delete Confirmation Dialog */}
			<ConfirmActionDialog
				open={canManage && deleteDialogOpen}
				onOpenChange={(open) => {
					setDeleteDialogOpen(open);
					if (!open) setDeleteError(null);
				}}
				title={t("settings.surcharges.deleteAssignmentTitle", "Remove Assignment?")}
				description={
					<>
						{selectedAssignment?.assignmentType === "organization" &&
							t(
								"settings.surcharges.deleteOrgAssignmentNamedDescription",
								'This will remove "{model}" as the organization default. Teams and employees without specific assignments will have no surcharge model applied.',
								{ model: selectedAssignment.model.name },
							)}
						{selectedAssignment?.assignmentType === "team" &&
							t(
								"settings.surcharges.deleteTeamAssignmentDescription",
								'This will remove the surcharge model from team "{team}". They will use the organization default.',
								{ team: selectedAssignment.team?.name },
							)}
						{selectedAssignment?.assignmentType === "employee" &&
							t(
								"settings.surcharges.deleteEmployeeAssignmentDescription",
								'This will remove the override for "{name}". They will use their team or organization default.',
								{
									name: `${selectedAssignment.employee?.firstName ?? ""} ${selectedAssignment.employee?.lastName ?? ""}`.trim(),
								},
							)}
					</>
				}
				confirmLabel={t("common.remove", "Remove")}
				pendingLabel={t("common.removing", "Removing...")}
				isPending={deleteMutation.isPending}
				error={deleteError}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}
