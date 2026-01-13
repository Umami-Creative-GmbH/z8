"use client";

import {
	IconAlertTriangle,
	IconBuilding,
	IconCalendarDollar,
	IconChevronRight,
	IconLoader2,
	IconPlus,
	IconStar,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteVacationPolicyAssignment,
	getCompanyDefaultPolicies,
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
	onAssignClick: (type: "team" | "employee") => void;
}

interface PolicyData {
	id: string;
	name: string;
	startDate: string;
	validUntil: string | null;
	isCompanyDefault: boolean;
	defaultAnnualDays: string;
	accrualType: string;
	allowCarryover: boolean;
	maxCarryoverDays: string | null;
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
	policy: PolicyData;
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

interface CompanyDefaultPolicies {
	current: PolicyData | null;
	next: PolicyData | null;
}

// Helper to format date for display
const formatDate = (dateStr: string) => {
	const [year, month, day] = dateStr.split("-").map(Number);
	return format(new Date(year, month - 1, day), "MMM d, yyyy");
};

// Helper to format policy summary
const formatPolicySummary = (policy: PolicyData, t: ReturnType<typeof useTranslate>["t"]) => {
	const parts = [`${policy.defaultAnnualDays} ${t("settings.vacation.days", "days")}`];
	if (policy.allowCarryover) {
		parts.push(t("settings.vacation.carryover", "Carryover"));
	}
	return parts.join(", ");
};

export function VacationAssignmentManager({
	organizationId,
	onAssignClick,
}: VacationAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] = useState<VacationPolicyAssignmentData | null>(
		null,
	);

	// Fetch company default policies (current and next)
	const {
		data: companyDefaults,
		isLoading: defaultsLoading,
	} = useQuery({
		queryKey: queryKeys.vacationPolicies.companyDefault(organizationId),
		queryFn: async () => {
			const result = await getCompanyDefaultPolicies(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch company default policies");
			}
			return result.data as CompanyDefaultPolicies;
		},
	});

	// Fetch policy assignments (for teams and employees)
	const {
		data: assignments,
		isLoading: assignmentsLoading,
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
				toast.success(t("settings.vacation.assignments.deleted", "Policy assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t("settings.vacation.assignments.deleteFailed", "Failed to remove policy assignment"),
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

	// Group assignments by type (filter out organization type - handled by isCompanyDefault)
	const policyAssignments = assignments || [];
	const teamAssignments = policyAssignments.filter((a) => a.assignmentType === "team");
	const employeeAssignments = policyAssignments.filter((a) => a.assignmentType === "employee");

	const isLoading = defaultsLoading || assignmentsLoading;

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

	return (
		<>
			<div className="space-y-6">
				{/* Info Banner */}
				<Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
					<CardContent className="py-4">
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.vacation.assignments.inheritanceInfo",
								"Policies are applied in priority order: Employee overrides take precedence over Team overrides, which take precedence over the Company Default. Create overrides only when needed.",
							)}
						</p>
					</CardContent>
				</Card>

				{/* Company Default Level (Read-only) */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconBuilding className="h-5 w-5 text-muted-foreground" />
							<div className="flex-1">
								<CardTitle className="text-base flex items-center gap-2">
									{t("settings.vacation.assignments.companyDefault", "Company Default")}
									<Badge variant="default" className="bg-primary">
										<IconStar className="mr-1 h-3 w-3" />
										{t("settings.vacation.required", "Required")}
									</Badge>
								</CardTitle>
								<CardDescription>
									{t(
										"settings.vacation.assignments.companyDefaultDescription",
										"The default policy applied to all employees. Manage defaults in the Policies tab.",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{!companyDefaults?.current ? (
							<div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/50 bg-destructive/10">
								<IconAlertTriangle className="h-5 w-5 text-destructive" />
								<div>
									<p className="font-medium text-destructive">
										{t("settings.vacation.noDefaultPolicy", "No Company Default Policy")}
									</p>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.vacation.noDefaultPolicyDescription",
											"Create a policy and mark it as Company Default in the Policies tab.",
										)}
									</p>
								</div>
							</div>
						) : (
							<>
								{/* Current Policy */}
								<div className="rounded-lg border p-4 bg-accent/30">
									<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
										<Badge variant="outline" className="text-xs">
											{t("settings.vacation.current", "Current")}
										</Badge>
										<span>
											{t("settings.vacation.since", "since")} {formatDate(companyDefaults.current.startDate)}
										</span>
									</div>
									<div className="flex items-center gap-3">
										<IconCalendarDollar className="h-4 w-4 text-primary" />
										<div>
											<span className="font-medium">{companyDefaults.current.name}</span>
											<span className="text-sm text-muted-foreground ml-2">
												— {formatPolicySummary(companyDefaults.current, t)}
											</span>
										</div>
									</div>
								</div>

								{/* Next Policy (if scheduled) */}
								{companyDefaults.next && (
									<div className="rounded-lg border p-4 border-dashed">
										<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
											<Badge variant="secondary" className="text-xs">
												{t("settings.vacation.next", "Next")}
											</Badge>
											<IconChevronRight className="h-3 w-3" />
											<span>
												{t("settings.vacation.startingOn", "starting on")} {formatDate(companyDefaults.next.startDate)}
											</span>
										</div>
										<div className="flex items-center gap-3">
											<IconCalendarDollar className="h-4 w-4 text-muted-foreground" />
											<div>
												<span className="font-medium">{companyDefaults.next.name}</span>
												<span className="text-sm text-muted-foreground ml-2">
													— {formatPolicySummary(companyDefaults.next, t)}
												</span>
											</div>
										</div>
									</div>
								)}
							</>
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
									{t("settings.vacation.assignments.teamLevel", "Team Overrides")}
									{teamAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.vacation.assignments.teamLevelDescription",
										"Override the company default for specific teams (e.g., different locations or schedules)",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-4">
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.vacation.assignments.assignTeam", "Assign to Team")}
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
											</Button>
										</div>
										<div className="mt-2 ml-7 space-y-1">
											<div className="flex items-center gap-2 text-sm">
												<Badge variant="outline" className="text-xs">
													{t("settings.vacation.current", "Current")}
												</Badge>
												<span className="text-muted-foreground">
													{assignment.policy.name} — {assignment.policy.defaultAnnualDays} {t("settings.vacation.days", "days")}
												</span>
												<span className="text-xs text-muted-foreground">
													({t("settings.vacation.since", "since")} {formatDate(assignment.policy.startDate)})
												</span>
											</div>
											{assignment.policy.validUntil && (
												<div className="flex items-center gap-2 text-sm text-amber-600">
													<Badge variant="outline" className="text-xs border-amber-300">
														{t("settings.vacation.expires", "Expires")}
													</Badge>
													<span>
														{formatDate(assignment.policy.validUntil)} → {t("settings.vacation.fallsBackToDefault", "Falls back to company default")}
													</span>
												</div>
											)}
										</div>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.vacation.assignments.noTeamPolicies",
									"No team-specific policies. All teams use the company default.",
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
										"Override team or company defaults for specific employees (e.g., special contracts)",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex justify-end mb-4">
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.vacation.assignments.assignEmployee", "Assign to Employee")}
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
												<span className="font-medium">
													{assignment.employee?.firstName} {assignment.employee?.lastName}
												</span>
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
										<div className="mt-2 ml-7 space-y-1">
											<div className="flex items-center gap-2 text-sm">
												<Badge variant="outline" className="text-xs">
													{t("settings.vacation.current", "Current")}
												</Badge>
												<span className="text-muted-foreground">
													{assignment.policy.name} — {assignment.policy.defaultAnnualDays} {t("settings.vacation.days", "days")}
												</span>
												<span className="text-xs text-muted-foreground">
													({t("settings.vacation.since", "since")} {formatDate(assignment.policy.startDate)})
												</span>
											</div>
											{assignment.policy.validUntil && (
												<div className="flex items-center gap-2 text-sm text-amber-600">
													<Badge variant="outline" className="text-xs border-amber-300">
														{t("settings.vacation.expires", "Expires")}
													</Badge>
													<span>
														{formatDate(assignment.policy.validUntil)} → {t("settings.vacation.fallsBackToTeamOrDefault", "Falls back to team or company default")}
													</span>
												</div>
											)}
										</div>
									</div>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t(
									"settings.vacation.assignments.noEmployeePolicies",
									"No employee-specific policies. Employees use their team or company default.",
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
							{selectedAssignment?.assignmentType === "team" &&
								t(
									"settings.vacation.assignments.deleteTeamDescription",
									'This will remove the policy from team "{team}". They will use the company default.',
									{ team: selectedAssignment.team?.name },
								)}
							{selectedAssignment?.assignmentType === "employee" &&
								t(
									"settings.vacation.assignments.deleteEmployeeDescription",
									'This will remove the override for "{name}". They will use their team or company default.',
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
