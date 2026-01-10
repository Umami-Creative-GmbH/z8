"use client";

import {
	IconBuilding,
	IconClock,
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
	deleteWorkScheduleAssignment,
	getWorkScheduleAssignments,
	type WorkScheduleAssignmentWithRelations,
} from "@/app/[locale]/(app)/settings/work-schedules/assignment-actions";
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

interface WorkScheduleAssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

const cycleLabels: Record<string, string> = {
	daily: "Daily",
	weekly: "Weekly",
	biweekly: "Biweekly",
	monthly: "Monthly",
	yearly: "Yearly",
};

export function WorkScheduleAssignmentManager({
	organizationId,
	onAssignClick,
}: WorkScheduleAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<WorkScheduleAssignmentWithRelations | null>(null);

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.workScheduleAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getWorkScheduleAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as WorkScheduleAssignmentWithRelations[];
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteWorkScheduleAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workSchedules.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workScheduleAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t("settings.workSchedules.assignmentDeleteFailed", "Failed to remove assignment"),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.workSchedules.assignmentDeleteFailed", "Failed to remove assignment"),
			);
		},
	});

	const handleDeleteClick = (assignment: WorkScheduleAssignmentWithRelations) => {
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
						{t("settings.workSchedules.assignmentsLoadError", "Failed to load assignments")}
					</p>
				</CardContent>
			</Card>
		);
	}

	const formatSchedule = (template: WorkScheduleAssignmentWithRelations["template"]) => {
		const hours =
			template.scheduleType === "simple"
				? template.hoursPerCycle
				: template.days
						.filter((d) => d.isWorkDay)
						.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0)
						.toFixed(1);
		return `${template.name} (${hours}h/${cycleLabels[template.scheduleCycle]?.toLowerCase() || template.scheduleCycle})`;
	};

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
									{t("settings.workSchedules.orgLevel", "Organization Default")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.workSchedules.orgLevelDescription",
										"Default work schedule applied to all employees unless overridden",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{orgAssignment ? (
							<div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
								<div className="flex items-center gap-3">
									<IconClock className="h-5 w-5 text-muted-foreground" />
									<div>
										<p className="font-medium">{formatSchedule(orgAssignment.template)}</p>
										{orgAssignment.template.homeOfficeDaysPerCycle > 0 && (
											<p className="text-xs text-muted-foreground">
												{orgAssignment.template.homeOfficeDaysPerCycle}{" "}
												{t("settings.workSchedules.homeOfficeDaysPerCycle", "home office days")}
											</p>
										)}
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
									{t("settings.workSchedules.noOrgAssignment", "No organization default set")}
								</p>
								<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.workSchedules.assignSchedule", "Assign Schedule")}
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
										{t("settings.workSchedules.teamLevel", "Team Overrides")}
										{teamAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{teamAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.workSchedules.teamLevelDescription",
											"Override the organization default for specific teams",
										)}
									</CardDescription>
								</div>
							</div>
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.workSchedules.addTeam", "Add Team")}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						{teamAssignments.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.workSchedules.noTeamAssignments", "No team-specific schedules")}
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
												<p className="font-medium">{assignment.team?.name || "Unknown Team"}</p>
												<p className="text-xs text-muted-foreground">
													{formatSchedule(assignment.template)}
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
										{t("settings.workSchedules.employeeLevel", "Employee Overrides")}
										{employeeAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{employeeAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.workSchedules.employeeLevelDescription",
											"Override schedules for specific employees",
										)}
									</CardDescription>
								</div>
							</div>
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.workSchedules.addEmployee", "Add Employee")}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						{employeeAssignments.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.workSchedules.noEmployeeAssignments",
									"No employee-specific schedules",
								)}
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
															"Unknown"
														: "Unknown Employee"}
												</p>
												<p className="text-xs text-muted-foreground">
													{formatSchedule(assignment.template)}
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
							{t("settings.workSchedules.removeAssignment", "Remove Assignment")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.workSchedules.removeAssignmentDescription",
								"Are you sure you want to remove this schedule assignment? The affected employees will inherit their schedule from the next level up.",
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
