"use client";

import {
	IconBuilding,
	IconGavel,
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
	deleteTimeRegulationAssignment,
	getTimeRegulationAssignments,
	type TimeRegulationAssignmentWithRelations,
} from "@/app/[locale]/(app)/settings/time-regulations/actions";
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

interface TimeRegulationAssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

// formatMinutesToHours helper is defined inside the component for i18n access

export function TimeRegulationAssignmentManager({
	organizationId,
	onAssignClick,
}: TimeRegulationAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<TimeRegulationAssignmentWithRelations | null>(null);

	// Helper function to format minutes to hours with translation
	const formatMinutesToHours = (minutes: number | null): string => {
		if (minutes === null) return "—";
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (mins === 0) {
			return t("settings.timeRegulations.hoursFormat", "{hours}h", { hours });
		}
		return t("settings.timeRegulations.hoursMinutesFormat", "{hours}h {mins}m", { hours, mins });
	};

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.timeRegulations.assignments(organizationId),
		queryFn: async () => {
			const result = await getTimeRegulationAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as TimeRegulationAssignmentWithRelations[];
		},
		staleTime: 30 * 1000, // Consider data fresh for 30 seconds
		refetchOnWindowFocus: false, // Don't refetch on window focus
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteTimeRegulationAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.timeRegulations.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeRegulations.assignments(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t("settings.timeRegulations.assignmentDeleteFailed", "Failed to remove assignment"),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.timeRegulations.assignmentDeleteFailed", "Failed to remove assignment"),
			);
		},
	});

	const handleDeleteClick = (assignment: TimeRegulationAssignmentWithRelations) => {
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
						{t("settings.timeRegulations.assignmentsLoadError", "Failed to load assignments")}
					</p>
				</CardContent>
			</Card>
		);
	}

	const formatRegulation = (regulation: TimeRegulationAssignmentWithRelations["regulation"]) => {
		const parts: string[] = [];
		if (regulation.maxDailyMinutes) {
			parts.push(
				t("settings.timeRegulations.perDay", "{hours}/day", {
					hours: formatMinutesToHours(regulation.maxDailyMinutes),
				}),
			);
		}
		if (regulation.maxWeeklyMinutes) {
			parts.push(
				t("settings.timeRegulations.perWeek", "{hours}/week", {
					hours: formatMinutesToHours(regulation.maxWeeklyMinutes),
				}),
			);
		}
		const breakRulesCount = regulation.breakRules?.length || 0;
		if (breakRulesCount > 0) {
			parts.push(
				t("settings.timeRegulations.breakRuleCount", "{count} break rule(s)", {
					count: breakRulesCount,
				}),
			);
		}
		return parts.length > 0 ? parts.join(", ") : t("settings.timeRegulations.noLimitsSet", "No limits set");
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
									{t("settings.timeRegulations.orgLevel", "Organization Default")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.timeRegulations.orgLevelDescription",
										"Default time regulation applied to all employees unless overridden",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{orgAssignment ? (
							<div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
								<div className="flex items-center gap-3">
									<IconGavel className="h-5 w-5 text-muted-foreground" />
									<div>
										<p className="font-medium">{orgAssignment.regulation.name}</p>
										<p className="text-xs text-muted-foreground">
											{formatRegulation(orgAssignment.regulation)}
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
									{t("settings.timeRegulations.noOrgAssignment", "No organization default set")}
								</p>
								<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.timeRegulations.assignRegulation", "Assign Regulation")}
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
										{t("settings.timeRegulations.teamLevel", "Team Overrides")}
										{teamAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{teamAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.timeRegulations.teamLevelDescription",
											"Override the organization default for specific teams",
										)}
									</CardDescription>
								</div>
							</div>
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.timeRegulations.addTeam", "Add Team")}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						{teamAssignments.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.timeRegulations.noTeamAssignments", "No team-specific regulations")}
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
												<p className="font-medium">{assignment.team?.name || t("common.unknownTeam", "Unknown Team")}</p>
												<p className="text-xs text-muted-foreground">
													{assignment.regulation.name}
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
										{t("settings.timeRegulations.employeeLevel", "Employee Overrides")}
										{employeeAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{employeeAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.timeRegulations.employeeLevelDescription",
											"Override regulations for specific employees",
										)}
									</CardDescription>
								</div>
							</div>
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.timeRegulations.addEmployee", "Add Employee")}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						{employeeAssignments.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.timeRegulations.noEmployeeAssignments",
									"No employee-specific regulations",
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
															t("common.unknown", "Unknown")
														: t("common.unknownEmployee", "Unknown Employee")}
												</p>
												<p className="text-xs text-muted-foreground">
													{assignment.regulation.name}
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
							{t("settings.timeRegulations.removeAssignment", "Remove Assignment")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.timeRegulations.removeAssignmentDescription",
								"Are you sure you want to remove this regulation assignment? The affected employees will inherit their regulation from the next level up.",
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
