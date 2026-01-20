"use client";

import {
	IconBuilding,
	IconLoader2,
	IconLock,
	IconPlus,
	IconShieldCheck,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteChangePolicyAssignment,
	getChangePolicyAssignments,
	type ChangePolicyAssignmentWithDetails,
} from "@/app/[locale]/(app)/settings/change-policies/actions";
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

interface ChangePolicyAssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

// Helper to format policy summary
const formatPolicySummary = (
	policy: ChangePolicyAssignmentWithDetails["policy"],
	t: ReturnType<typeof useTranslate>["t"],
) => {
	if (!policy) return "";

	if (policy.noApprovalRequired) {
		return t("settings.changePolicies.trustModeLabel", "Trust Mode");
	}

	const parts: string[] = [];
	if (policy.selfServiceDays === 0) {
		parts.push(t("settings.changePolicies.sameDaySelfService", "Same-day self-service"));
	} else {
		parts.push(
			t("settings.changePolicies.daysSelfService", "{days}d self-service", {
				days: policy.selfServiceDays,
			}),
		);
	}

	if (policy.approvalDays > 0) {
		parts.push(
			t("settings.changePolicies.daysApprovalWindow", "{days}d approval", {
				days: policy.approvalDays,
			}),
		);
	}

	return parts.join(", ");
};

// Helper to get employee display name
const getEmployeeName = (employee: { firstName: string | null; lastName: string | null } | null) => {
	if (!employee) return "";
	const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ");
	return name || "Unnamed";
};

export function ChangePolicyAssignmentManager({
	organizationId,
	onAssignClick,
}: ChangePolicyAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<ChangePolicyAssignmentWithDetails | null>(null);

	// Fetch assignments
	const {
		data: assignments,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.changePolicies.assignments(organizationId),
		queryFn: async () => {
			const result = await getChangePolicyAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data;
		},
		staleTime: 30 * 1000,
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteChangePolicyAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.changePolicies.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.changePolicies.assignments(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t("settings.changePolicies.assignmentDeleteFailed", "Failed to remove assignment"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.changePolicies.assignmentDeleteFailed", "Failed to remove assignment"));
		},
	});

	const handleDeleteClick = (assignment: ChangePolicyAssignmentWithDetails) => {
		setSelectedAssignment(assignment);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignment) {
			deleteMutation.mutate(selectedAssignment.id);
		}
	};

	// Group assignments by type
	const orgAssignment = assignments?.find((a) => a.assignmentType === "organization") ?? null;
	const teamAssignments = assignments?.filter((a) => a.assignmentType === "team") ?? [];
	const employeeAssignments = assignments?.filter((a) => a.assignmentType === "employee") ?? [];

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
						{t("settings.changePolicies.assignmentsLoadError", "Failed to load policy assignments")}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<div className="space-y-6">
				{/* Info Banner */}
				<Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
					<CardContent className="py-4">
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.changePolicies.inheritanceInfo",
								"Policies are applied in priority order: Employee overrides take precedence over Team overrides, which take precedence over the Organization Default. If no policy is assigned at any level, employees can edit their time entries without restrictions.",
							)}
						</p>
					</CardContent>
				</Card>

				{/* Organization Default Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconBuilding className="h-5 w-5 text-muted-foreground" />
							<div className="flex-1">
								<CardTitle className="text-base">
									{t("settings.changePolicies.organizationDefault", "Organization Default")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.changePolicies.organizationDefaultDescription",
										"The default policy applied to all employees who don't have a team or individual override.",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{orgAssignment ? (
							<div className="rounded-lg border p-4 bg-accent/30">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<IconShieldCheck className="h-4 w-4 text-primary" />
										<div>
											<span className="font-medium">{orgAssignment.policy?.name}</span>
											{orgAssignment.policy?.noApprovalRequired && (
												<Badge variant="outline" className="ml-2 text-xs">
													{t("settings.changePolicies.trustMode", "Trust Mode")}
												</Badge>
											)}
											<span className="text-sm text-muted-foreground ml-2">
												— {formatPolicySummary(orgAssignment.policy, t)}
											</span>
										</div>
									</div>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-muted-foreground hover:text-destructive"
										onClick={() => handleDeleteClick(orgAssignment)}
									>
										<IconTrash className="h-4 w-4" />
										<span className="sr-only">{t("common.remove", "Remove")}</span>
									</Button>
								</div>
							</div>
						) : (
							<div className="space-y-4">
								<div className="flex items-center gap-3 p-4 rounded-lg border border-dashed">
									<IconLock className="h-5 w-5 text-muted-foreground" />
									<div>
										<p className="font-medium text-muted-foreground">
											{t("settings.changePolicies.noOrgDefault", "No Organization Default")}
										</p>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.changePolicies.noOrgDefaultDescription",
												"Without an organization default, employees can edit their time entries without restrictions.",
											)}
										</p>
									</div>
								</div>
								<div className="flex justify-end">
									<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.changePolicies.setOrgDefault", "Set Organization Default")}
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Team Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconUsers className="h-5 w-5 text-muted-foreground" />
							<div className="flex-1">
								<CardTitle className="text-base">
									{t("settings.changePolicies.teamOverrides", "Team Overrides")}
									{teamAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.changePolicies.teamOverridesDescription",
										"Override the organization default for specific teams (e.g., different departments or work schedules).",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-4">
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.changePolicies.assignToTeam", "Assign to Team")}
							</Button>
						</div>
						{teamAssignments.length > 0 ? (
							<div className="space-y-3">
								{teamAssignments.map((assignment) => (
									<div
										key={assignment.id}
										className="rounded-lg border p-4 hover:bg-accent/50 transition-colors"
									>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-3">
												<IconUsers className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">{assignment.team?.name}</span>
											</div>
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-muted-foreground hover:text-destructive"
												onClick={() => handleDeleteClick(assignment)}
											>
												<IconTrash className="h-4 w-4" />
												<span className="sr-only">{t("common.remove", "Remove")}</span>
											</Button>
										</div>
										<div className="mt-2 ml-7">
											<div className="flex items-center gap-2 text-sm">
												<Badge variant="outline" className="text-xs">
													{assignment.policy?.name}
												</Badge>
												{assignment.policy?.noApprovalRequired && (
													<Badge variant="secondary" className="text-xs">
														{t("settings.changePolicies.trustMode", "Trust Mode")}
													</Badge>
												)}
												<span className="text-muted-foreground">
													— {formatPolicySummary(assignment.policy, t)}
												</span>
											</div>
										</div>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.changePolicies.noTeamOverrides",
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
							<div className="flex-1">
								<CardTitle className="text-base">
									{t("settings.changePolicies.employeeOverrides", "Employee Overrides")}
									{employeeAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{employeeAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.changePolicies.employeeOverridesDescription",
										"Override team or organization defaults for specific employees (e.g., special arrangements).",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-4">
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.changePolicies.assignToEmployee", "Assign to Employee")}
							</Button>
						</div>
						{employeeAssignments.length > 0 ? (
							<div className="space-y-3">
								{employeeAssignments.map((assignment) => (
									<div
										key={assignment.id}
										className="rounded-lg border p-4 hover:bg-accent/50 transition-colors"
									>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-3">
												<IconUser className="h-4 w-4 text-muted-foreground" />
												<span className="font-medium">{getEmployeeName(assignment.employee)}</span>
											</div>
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-muted-foreground hover:text-destructive"
												onClick={() => handleDeleteClick(assignment)}
											>
												<IconTrash className="h-4 w-4" />
												<span className="sr-only">{t("common.remove", "Remove")}</span>
											</Button>
										</div>
										<div className="mt-2 ml-7">
											<div className="flex items-center gap-2 text-sm">
												<Badge variant="outline" className="text-xs">
													{assignment.policy?.name}
												</Badge>
												{assignment.policy?.noApprovalRequired && (
													<Badge variant="secondary" className="text-xs">
														{t("settings.changePolicies.trustMode", "Trust Mode")}
													</Badge>
												)}
												<span className="text-muted-foreground">
													— {formatPolicySummary(assignment.policy, t)}
												</span>
											</div>
										</div>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.changePolicies.noEmployeeOverrides",
									"No employee-specific policies. Employees use their team or organization default.",
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
							{t("settings.changePolicies.removeAssignmentTitle", "Remove Policy Assignment?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedAssignment?.assignmentType === "organization" &&
								t(
									"settings.changePolicies.removeOrgDescription",
									"This will remove the organization default policy. Employees will have no restrictions unless they have a team or individual override.",
								)}
							{selectedAssignment?.assignmentType === "team" &&
								t(
									"settings.changePolicies.removeTeamDescription",
									'This will remove the policy from team "{team}". They will use the organization default.',
									{ team: selectedAssignment.team?.name },
								)}
							{selectedAssignment?.assignmentType === "employee" &&
								t(
									"settings.changePolicies.removeEmployeeDescription",
									'This will remove the override for "{name}". They will use their team or organization default.',
									{ name: getEmployeeName(selectedAssignment.employee) },
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
									{t("common.removing", "Removing…")}
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
