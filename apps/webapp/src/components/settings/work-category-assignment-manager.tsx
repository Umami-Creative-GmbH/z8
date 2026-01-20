"use client";

import {
	IconBuilding,
	IconLoader2,
	IconPlus,
	IconTag,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteSetAssignment,
	getWorkCategorySetAssignments,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
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

interface WorkCategoryAssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

interface AssignmentData {
	id: string;
	setId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	set: {
		id: string;
		name: string;
		description: string | null;
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

export function WorkCategoryAssignmentManager({
	organizationId,
	onAssignClick,
}: WorkCategoryAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] = useState<AssignmentData | null>(null);

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.workCategorySetAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getWorkCategorySetAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as AssignmentData[];
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteSetAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.workCategories.assignmentDeleted", "Assignment removed"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategorySetAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.workCategories.assignmentDeleteFailed",
							"Failed to remove assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.workCategories.assignmentDeleteFailed", "Failed to remove assignment"),
			);
		},
	});

	const handleDeleteClick = (assignment: AssignmentData) => {
		setSelectedAssignment(assignment);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignment) {
			deleteMutation.mutate(selectedAssignment.id);
		}
	};

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
						{t("settings.workCategories.assignmentsLoadError", "Failed to load assignments")}
					</p>
				</CardContent>
			</Card>
		);
	}

	// Group assignments by type
	const allAssignments = assignments || [];
	const orgAssignment = allAssignments.find((a) => a.assignmentType === "organization");
	const teamAssignments = allAssignments.filter((a) => a.assignmentType === "team");
	const employeeAssignments = allAssignments.filter((a) => a.assignmentType === "employee");

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
									{t("settings.workCategories.orgLevel", "Organization Default")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.workCategories.orgLevelDescription",
										"Default category set applied to all employees unless overridden",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex items-center justify-between mb-2">
							<h4 className="text-sm font-medium text-muted-foreground">
								{t("settings.workCategories.defaultSet", "Default Category Set")}
							</h4>
							{!orgAssignment && (
								<Button
									onClick={() => onAssignClick("organization")}
									size="sm"
									variant="outline"
								>
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.workCategories.setDefault", "Set Default")}
								</Button>
							)}
						</div>
						{orgAssignment ? (
							<div className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
								<div className="flex items-center gap-3">
									<IconTag className="h-4 w-4 text-muted-foreground" />
									<div>
										<span className="font-medium">{orgAssignment.set.name}</span>
										{orgAssignment.set.description && (
											<p className="text-sm text-muted-foreground">
												{orgAssignment.set.description}
											</p>
										)}
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 text-muted-foreground hover:text-destructive"
									onClick={() => handleDeleteClick(orgAssignment)}
									aria-label={t("common.remove", "Remove")}
								>
									<IconTrash className="h-4 w-4" />
								</Button>
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-2 border rounded-lg bg-muted/30">
								{t(
									"settings.workCategories.noOrgDefault",
									"No default category set. Employees won't have work categories available.",
								)}
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
									{t("settings.workCategories.teamLevel", "Team Level")}
									{teamAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.workCategories.teamLevelDescription",
										"Override organization default for specific teams",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-2">
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.workCategories.assignTeam", "Assign to Team")}
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
												<span className="text-sm">{assignment.set.name}</span>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-muted-foreground hover:text-destructive"
											onClick={() => handleDeleteClick(assignment)}
											aria-label={t("common.remove", "Remove")}
										>
											<IconTrash className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.workCategories.noTeamAssignments",
									"No team-level assignments",
								)}
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
									{t("settings.workCategories.employeeLevel", "Employee Overrides")}
									{employeeAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{employeeAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.workCategories.employeeLevelDescription",
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
								{t("settings.workCategories.assignEmployee", "Assign to Employee")}
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
													{assignment.employee?.firstName}{" "}
													{assignment.employee?.lastName}
												</span>
												<span className="text-muted-foreground mx-2">→</span>
												<span className="text-sm">{assignment.set.name}</span>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-muted-foreground hover:text-destructive"
											onClick={() => handleDeleteClick(assignment)}
											aria-label={t("common.remove", "Remove")}
										>
											<IconTrash className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.workCategories.noEmployeeAssignments",
									"No employee-level overrides",
								)}
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
							{t("settings.workCategories.deleteAssignmentTitle", "Remove Assignment?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedAssignment?.assignmentType === "organization" &&
								t(
									"settings.workCategories.deleteOrgAssignment",
									"This will remove the organization default. Employees will not have work categories available unless assigned individually.",
								)}
							{selectedAssignment?.assignmentType === "team" &&
								t(
									"settings.workCategories.deleteTeamAssignment",
									'This will remove the category set from team "{team}". They will use the organization default.',
									{ team: selectedAssignment.team?.name },
								)}
							{selectedAssignment?.assignmentType === "employee" &&
								t(
									"settings.workCategories.deleteEmployeeAssignment",
									'This will remove the override for "{name}". They will use their team or organization default.',
									{
										name: `${selectedAssignment?.employee?.firstName} ${selectedAssignment?.employee?.lastName}`,
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
