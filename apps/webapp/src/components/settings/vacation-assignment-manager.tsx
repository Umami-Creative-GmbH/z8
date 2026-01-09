"use client";

import {
	IconBuilding,
	IconCalendarDollar,
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
	deleteVacationPolicyAssignment,
	getVacationPolicyAssignments,
} from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
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

interface VacationAssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

interface VacationPolicyAssignmentData {
	id: string;
	policyId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	policy: {
		id: string;
		year: number;
		defaultAnnualDays: string;
		accrualType: string;
		allowCarryover: boolean;
		maxCarryoverDays: string | null;
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

export function VacationAssignmentManager({
	organizationId,
	onAssignClick,
}: VacationAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<VacationPolicyAssignmentData | null>(null);

	// Fetch policy assignments
	const {
		data: assignments,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getVacationPolicyAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as VacationPolicyAssignmentData[];
		},
	});

	// Delete assignment mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteVacationPolicyAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.vacation.assignments.deleted", "Policy assignment removed"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.vacation.assignments.deleteFailed",
							"Failed to remove policy assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.vacation.assignments.deleteFailed", "Failed to remove policy assignment"),
			);
		},
	});

	const handleDeleteClick = (assignment: VacationPolicyAssignmentData) => {
		setSelectedAssignment(assignment);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignment) {
			deleteMutation.mutate(selectedAssignment.id);
		}
	};

	// Group assignments by type
	const policyAssignments = assignments || [];
	const orgAssignment = policyAssignments.find((a) => a.assignmentType === "organization");
	const teamAssignments = policyAssignments.filter((a) => a.assignmentType === "team");
	const employeeAssignments = policyAssignments.filter((a) => a.assignmentType === "employee");

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
						{t("settings.vacation.assignments.loadError", "Failed to load policy assignments")}
					</p>
				</CardContent>
			</Card>
		);
	}

	const formatPolicy = (policy: VacationPolicyAssignmentData["policy"]) => {
		return `${policy.year} - ${policy.defaultAnnualDays} ${t("settings.vacation.days", "days")}`;
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
									{t("settings.vacation.assignments.orgLevel", "Organization Default")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.vacation.assignments.orgLevelDescription",
										"Default vacation policy applied to all employees unless overridden",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex items-center justify-between mb-2">
							<h4 className="text-sm font-medium text-muted-foreground">
								{t("settings.vacation.assignments.policySection", "Vacation Policy")}
							</h4>
							{!orgAssignment && (
								<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.vacation.assignments.setDefault", "Set Default")}
								</Button>
							)}
						</div>
						{orgAssignment ? (
							<div className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
								<div className="flex items-center gap-3">
									<IconCalendarDollar className="h-4 w-4 text-muted-foreground" />
									<div>
										<span className="font-medium">{formatPolicy(orgAssignment.policy)}</span>
										<span className="text-sm text-muted-foreground ml-2">
											({orgAssignment.policy.accrualType})
										</span>
										{orgAssignment.policy.allowCarryover && (
											<Badge variant="secondary" className="ml-2">
												{t("settings.vacation.carryover", "Carryover")}
											</Badge>
										)}
									</div>
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
								{t("settings.vacation.assignments.noOrgPolicy", "No default policy set")}
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
									{t("settings.vacation.assignments.teamLevel", "Team Policies")}
									{teamAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.vacation.assignments.teamLevelDescription",
										"Override organization default for specific teams (e.g., different locations)",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-2">
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.vacation.assignments.assignTeam", "Assign to Team")}
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
												<span className="text-sm">{formatPolicy(assignment.policy)}</span>
												{assignment.policy.allowCarryover && (
													<Badge variant="secondary" className="ml-2 text-xs">
														{t("settings.vacation.carryover", "Carryover")}
													</Badge>
												)}
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
								{t(
									"settings.vacation.assignments.noTeamPolicies",
									"No team-specific policies. All teams use the organization default.",
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
									{t("settings.vacation.assignments.employeeLevel", "Employee Overrides")}
									{employeeAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{employeeAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.vacation.assignments.employeeLevelDescription",
										"Override team or organization policy for specific employees",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-2">
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.vacation.assignments.assignEmployee", "Assign to Employee")}
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
												<span className="text-sm">{formatPolicy(assignment.policy)}</span>
												{assignment.policy.allowCarryover && (
													<Badge variant="secondary" className="ml-2 text-xs">
														{t("settings.vacation.carryover", "Carryover")}
													</Badge>
												)}
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
								{t(
									"settings.vacation.assignments.noEmployeePolicies",
									"No employee-specific policies. All employees use their team or organization default.",
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
							{t("settings.vacation.assignments.deleteTitle", "Remove Policy Assignment?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedAssignment?.assignmentType === "organization" &&
								t(
									"settings.vacation.assignments.deleteOrgDescription",
									"This will remove the organization default policy. Teams and employees will need individual assignments.",
								)}
							{selectedAssignment?.assignmentType === "team" &&
								t(
									"settings.vacation.assignments.deleteTeamDescription",
									'This will remove the policy from team "{team}". They will use the organization default.',
									{ team: selectedAssignment.team?.name },
								)}
							{selectedAssignment?.assignmentType === "employee" &&
								t(
									"settings.vacation.assignments.deleteEmployeeDescription",
									'This will remove the policy override for "{name}". They will use their team or organization default.',
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
