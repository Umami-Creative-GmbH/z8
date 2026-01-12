"use client";

import {
	IconBuilding,
	IconLoader2,
	IconPercentage,
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
	deleteSurchargeAssignment,
	getSurchargeAssignments,
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
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";

interface SurchargeAssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

interface SurchargeAssignmentData {
	id: string;
	modelId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	model: {
		id: string;
		name: string;
	};
	team: {
		id: string;
		name: string;
	} | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
}

export function SurchargeAssignmentManager({
	organizationId,
	onAssignClick,
}: SurchargeAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] = useState<SurchargeAssignmentData | null>(
		null,
	);

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.surcharges.assignments.list(organizationId),
		queryFn: async () => {
			const result = await getSurchargeAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			// Filter only active assignments
			return (result.data as SurchargeAssignmentData[]).filter((a) => a.isActive);
		},
	});

	// Delete assignment mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteSurchargeAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.surcharges.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.surcharges.assignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t("settings.surcharges.assignmentDeleteFailed", "Failed to remove assignment"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.surcharges.assignmentDeleteFailed", "Failed to remove assignment"));
		},
	});

	const handleDeleteClick = (assignment: SurchargeAssignmentData) => {
		setSelectedAssignment(assignment);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignment) {
			deleteMutation.mutate(selectedAssignment.id);
		}
	};

	// Group assignments by type
	const allAssignments = assignments || [];
	const orgAssignment = allAssignments.find((a) => a.assignmentType === "organization");
	const teamAssignments = allAssignments.filter((a) => a.assignmentType === "team");
	const employeeAssignments = allAssignments.filter((a) => a.assignmentType === "employee");

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
						{t("settings.surcharges.loadError", "Failed to load assignments")}
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
									{t("settings.surcharges.orgLevel", "Organization Level")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.surcharges.orgLevelDescription",
										"Default surcharge model applied to all employees unless overridden",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex items-center justify-between mb-2">
							<h4 className="text-sm font-medium text-muted-foreground">
								{t("settings.surcharges.defaultModel", "Default Model")}
							</h4>
							{!orgAssignment && (
								<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.surcharges.setDefault", "Set Default")}
								</Button>
							)}
						</div>
						{orgAssignment ? (
							<div className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
								<div className="flex items-center gap-3">
									<IconPercentage className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium">{orgAssignment.model.name}</span>
								</div>
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 text-muted-foreground hover:text-destructive"
									onClick={() => handleDeleteClick(orgAssignment)}
								>
									<IconTrash className="h-4 w-4" />
								</Button>
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-2 border rounded-lg bg-muted/30">
								{t("settings.surcharges.noOrgDefault", "No default surcharge model set")}
							</p>
						)}
					</CardContent>
				</Card>

				{/* Team Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconUsers className="h-5 w-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.surcharges.teamLevel", "Team Level")}
									{teamAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.surcharges.teamLevelDescription",
										"Override organization defaults for specific teams",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-2">
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.surcharges.assignTeam", "Assign to Team")}
							</Button>
						</div>
						{teamAssignments.length > 0 ? (
							<div className="space-y-2">
								{teamAssignments.map((assignment) => (
									<div
										key={assignment.id}
										className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
									>
										<div className="flex items-center gap-3">
											<IconUsers className="h-4 w-4 text-muted-foreground" />
											<div>
												<span className="font-medium">{assignment.team?.name}</span>
												<span className="text-muted-foreground mx-2">→</span>
												<span className="text-sm">{assignment.model.name}</span>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-muted-foreground hover:text-destructive"
											onClick={() => handleDeleteClick(assignment)}
										>
											<IconTrash className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.surcharges.noTeamAssignments", "No team-level assignments")}
							</p>
						)}
					</CardContent>
				</Card>

				{/* Employee Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconUser className="h-5 w-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.surcharges.employeeLevel", "Employee Overrides")}
									{employeeAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{employeeAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.surcharges.employeeLevelDescription",
										"Override team or organization defaults for specific employees",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-2">
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.surcharges.assignEmployee", "Assign to Employee")}
							</Button>
						</div>
						{employeeAssignments.length > 0 ? (
							<div className="space-y-2">
								{employeeAssignments.map((assignment) => (
									<div
										key={assignment.id}
										className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
									>
										<div className="flex items-center gap-3">
											<IconUser className="h-4 w-4 text-muted-foreground" />
											<div>
												<span className="font-medium">
													{assignment.employee?.firstName} {assignment.employee?.lastName}
												</span>
												<span className="text-muted-foreground mx-2">→</span>
												<span className="text-sm">{assignment.model.name}</span>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-muted-foreground hover:text-destructive"
											onClick={() => handleDeleteClick(assignment)}
										>
											<IconTrash className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.surcharges.noEmployeeAssignments", "No employee-level overrides")}
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.surcharges.deleteAssignmentTitle", "Remove Assignment?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedAssignment?.assignmentType === "organization" &&
								t(
									"settings.surcharges.deleteOrgAssignmentDescription",
									"This will remove the organization default. Teams and employees without specific assignments will have no surcharge model applied.",
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
										name: `${selectedAssignment.employee?.firstName} ${selectedAssignment.employee?.lastName}`,
									},
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
									{t("common.removing", "Removing...")}
								</>
							) : (
								t("common.remove", "Remove")
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
