"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	deleteWorkPolicyAssignment,
	getWorkPolicyAssignments,
	type WorkPolicyAssignmentWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";
import { getWorkPolicyAssignmentSectionVisibility } from "../policy-assignment-surface";
import { WorkPolicyAssignmentSections } from "./work-policy-assignment-sections";

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
	const selectedAssignmentRef = useRef<WorkPolicyAssignmentWithDetails | null>(null);

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.workPolicies.assignments(organizationId),
		queryFn: async () => {
			const result = await getWorkPolicyAssignments(organizationId);
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
				selectedAssignmentRef.current = null;
			} else {
				toast.error(
					result.error ||
						t("settings.workPolicies.assignmentDeleteFailed", "Failed to remove assignment"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.assignmentDeleteFailed", "Failed to remove assignment"));
		},
	});

	const handleDeleteClick = (assignment: WorkPolicyAssignmentWithDetails) => {
		selectedAssignmentRef.current = assignment;
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignmentRef.current) {
			deleteMutation.mutate(selectedAssignmentRef.current.id);
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
		return (
			<div className="space-y-6">
				{[1, 2, 3].map((i) => (
					<Card key={i}>
						<CardHeader>
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-64" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-16 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">
						{t("settings.workPolicies.assignmentsLoadError", "Failed to load assignments")}
					</p>
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

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.workPolicies.removeAssignment", "Remove Assignment")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
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
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("common.remove", "Remove")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
