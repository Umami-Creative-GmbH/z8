"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteWorkPolicyAssignment,
	getWorkPolicyAssignments,
	type WorkPolicyAssignmentWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { AssignmentManagerSkeleton } from "@/components/settings/assignment-manager-skeleton";
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
import { Card, CardContent } from "@/components/ui/card";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { getWorkPolicyAssignmentSectionVisibility } from "../policy-assignment-surface";
import {
	WorkPolicyAssignmentSections,
	workPolicyAssignmentTargetLabel,
} from "./work-policy-assignment-sections";

interface WorkPolicyAssignmentManagerProps {
	organizationId: string;
	allowedAssignmentTypes: readonly ("organization" | "team" | "employee")[];
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

export function WorkPolicyAssignmentManager({
	organizationId,
	allowedAssignmentTypes,
	onAssignClick,
}: WorkPolicyAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<WorkPolicyAssignmentWithDetails | null>(null);

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: queryKeys.workPolicies.assignments(organizationId),
		queryFn: async () => {
			const result = await getWorkPolicyAssignments();
			if (!result.success) {
				return Promise.reject(result.error || "Failed to fetch assignments");
			}
			return result.data as WorkPolicyAssignmentWithDetails[];
		},
		staleTime: 30 * 1000,
		refetchOnWindowFocus: false,
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteWorkPolicyAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.assignments(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.workPolicies.assignmentDeleteFailed",
						"Failed to remove assignment",
					]),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.assignmentDeleteFailed", "Failed to remove assignment"));
		},
	});

	const handleDeleteClick = (assignment: WorkPolicyAssignmentWithDetails) => {
		setSelectedAssignment(assignment);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignment) {
			deleteMutation.mutate(selectedAssignment.id);
		}
	};

	// Group assignments by type
	const orgAssignment = assignments?.find((a) => a.assignmentType === "organization");
	const teamAssignments = assignments?.filter((a) => a.assignmentType === "team") || [];
	const employeeAssignments = assignments?.filter((a) => a.assignmentType === "employee") || [];
	const canManageOrgAssignments = allowedAssignmentTypes.includes("organization");
	const canManageTeamAssignments = allowedAssignmentTypes.includes("team");
	const canManageEmployeeAssignments = allowedAssignmentTypes.includes("employee");
	const { showOrgSection, showTeamSection, showEmployeeSection } =
		getWorkPolicyAssignmentSectionVisibility({
			canManageOrgAssignments,
			hasOrgAssignment: Boolean(orgAssignment),
			canManageTeamAssignments,
			teamAssignmentsCount: teamAssignments.length,
			canManageEmployeeAssignments,
			employeeAssignmentsCount: employeeAssignments.length,
		});

	if (isLoading) {
		return <AssignmentManagerSkeleton />;
	}

	if (error) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-4 py-8 text-center">
					<p role="alert" className="text-destructive">
						{t("settings.workPolicies.assignmentsLoadError", "Failed to load assignments")}
					</p>
					<Button variant="outline" onClick={() => refetch()}>
						<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						{t("common.retry", "Retry")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<div className="space-y-6">
				<WorkPolicyAssignmentSections
					sections={{
						organization: showOrgSection
							? { assignment: orgAssignment, canManage: canManageOrgAssignments }
							: undefined,
						team: showTeamSection
							? { assignments: teamAssignments, canManage: canManageTeamAssignments }
							: undefined,
						employee: showEmployeeSection
							? { assignments: employeeAssignments, canManage: canManageEmployeeAssignments }
							: undefined,
					}}
					onAssignClick={onAssignClick}
					onDeleteClick={handleDeleteClick}
				/>
			</div>

			<AlertDialog
				open={deleteDialogOpen}
				onOpenChange={(open) => {
					// A removal in flight keeps the dialog open so its outcome stays visible.
					if (!open && deleteMutation.isPending) return;
					setDeleteDialogOpen(open);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.workPolicies.removeAssignment", "Remove Assignment")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedAssignment
								? t(
										"settings.workPolicies.removeAssignmentNamedDescription",
										'Remove the policy "{policy}" from {target}? The affected employees will inherit their policy from the next level up.',
										{
											policy: selectedAssignment.policy?.name ?? t("common.unknown", "Unknown"),
											target: workPolicyAssignmentTargetLabel(selectedAssignment, t),
										},
									)
								: t(
										"settings.workPolicies.removeAssignmentDescription",
										"Are you sure you want to remove this policy assignment? The affected employees will inherit their policy from the next level up.",
									)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open, showing progress, until the removal settles.
								// Base UI's Close ignores preventDefault; its own handler must be stopped.
								event.preventDefault();
								(
									event as unknown as { preventBaseUIHandler?: () => void }
								).preventBaseUIHandler?.();
								if (deleteMutation.isPending) return;
								handleDeleteConfirm();
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{t("common.remove", "Remove")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
