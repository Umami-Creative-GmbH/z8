"use client";

import {
	IconBuilding,
	IconFileText,
	IconLoader2,
	IconPlus,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";

interface WorkPolicyAssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

export function WorkPolicyAssignmentManager({
	organizationId,
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
				setSelectedAssignment(null);
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
				{/* Organization Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconBuilding className="h-5 w-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.workPolicies.orgLevel", "Organization Default")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.workPolicies.orgLevelDescription",
										"Default work policy applied to all employees unless overridden",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{orgAssignment ? (
							<div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
								<div className="flex items-center gap-3">
									<IconFileText className="h-5 w-5 text-muted-foreground" />
									<div>
										<p className="font-medium">
											{orgAssignment.policy?.name || t("common.unknown", "Unknown")}
										</p>
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon"
									className="text-destructive hover:text-destructive"
									onClick={() => handleDeleteClick(orgAssignment)}
								>
									<IconTrash className="h-4 w-4" />
								</Button>
							</div>
						) : (
							<div className="flex items-center justify-between p-3 rounded-lg border border-dashed">
								<p className="text-sm text-muted-foreground">
									{t("settings.workPolicies.noOrgAssignment", "No organization default set")}
								</p>
								<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.workPolicies.assignPolicy", "Assign Policy")}
								</Button>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Team Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<IconUsers className="h-5 w-5 text-muted-foreground" />
								<div>
									<CardTitle className="text-base">
										{t("settings.workPolicies.teamLevel", "Team Overrides")}
										{teamAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{teamAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.workPolicies.teamLevelDescription",
											"Override the organization default for specific teams",
										)}
									</CardDescription>
								</div>
							</div>
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.workPolicies.addTeam", "Add Team")}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						{teamAssignments.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.workPolicies.noTeamAssignments", "No team-specific policies")}
							</p>
						) : (
							<div className="space-y-2">
								{teamAssignments.map((assignment) => (
									<div
										key={assignment.id}
										className="flex items-center justify-between p-3 rounded-lg border"
									>
										<div className="flex items-center gap-3">
											<IconUsers className="h-4 w-4 text-muted-foreground" />
											<div>
												<p className="font-medium">
													{assignment.team?.name || t("common.unknownTeam", "Unknown Team")}
												</p>
												<p className="text-xs text-muted-foreground">
													{assignment.policy?.name || t("common.unknown", "Unknown")}
												</p>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											className="text-destructive hover:text-destructive"
											onClick={() => handleDeleteClick(assignment)}
										>
											<IconTrash className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Employee Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<IconUser className="h-5 w-5 text-muted-foreground" />
								<div>
									<CardTitle className="text-base">
										{t("settings.workPolicies.employeeLevel", "Employee Overrides")}
										{employeeAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{employeeAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.workPolicies.employeeLevelDescription",
											"Override policies for specific employees",
										)}
									</CardDescription>
								</div>
							</div>
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.workPolicies.addEmployee", "Add Employee")}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						{employeeAssignments.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.workPolicies.noEmployeeAssignments", "No employee-specific policies")}
							</p>
						) : (
							<div className="space-y-2">
								{employeeAssignments.map((assignment) => (
									<div
										key={assignment.id}
										className="flex items-center justify-between p-3 rounded-lg border"
									>
										<div className="flex items-center gap-3">
											<IconUser className="h-4 w-4 text-muted-foreground" />
											<div>
												<p className="font-medium">
													{assignment.employee
														? `${assignment.employee.firstName || ""} ${assignment.employee.lastName || ""}`.trim() ||
															t("common.unknown", "Unknown")
														: t("common.unknownEmployee", "Unknown Employee")}
												</p>
												<p className="text-xs text-muted-foreground">
													{assignment.policy?.name || t("common.unknown", "Unknown")}
												</p>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											className="text-destructive hover:text-destructive"
											onClick={() => handleDeleteClick(assignment)}
										>
											<IconTrash className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
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
							{deleteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.remove", "Remove")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
