"use client";

import {
	IconBuilding,
	IconInfoCircle,
	IconLock,
	IconPlus,
	IconRefresh,
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
	type ChangePolicyAssignmentWithDetails,
	deleteChangePolicyAssignment,
	getChangePolicyAssignments,
} from "@/app/[locale]/(app)/settings/change-policies/actions";
import { AssignmentManagerSkeleton } from "@/components/settings/assignment-manager-skeleton";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { AssignmentLevelCardHeader } from "@/components/settings/assignment-level-card-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";

interface ChangePolicyAssignmentManagerProps {
	canManage: boolean;
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
}

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

const getEmployeeName = (
	employee: { firstName: string | null; lastName: string | null } | null,
	t: ReturnType<typeof useTranslate>["t"],
) => {
	if (!employee) return t("common.unknownEmployee", "Unknown Employee");
	return buildAuthUserDisplayName(employee) || t("common.unnamed", "Unnamed");
};

const getAssignmentTargetLabel = (
	assignment: ChangePolicyAssignmentWithDetails,
	t: ReturnType<typeof useTranslate>["t"],
) => {
	switch (assignment.assignmentType) {
		case "organization":
			return t("settings.changePolicies.organizationDefault", "Organization Default");
		case "team":
			return assignment.team?.name || t("common.unknownTeam", "Unknown Team");
		default:
			return getEmployeeName(assignment.employee, t);
	}
};

function RemoveAssignmentButton({
	assignment,
	t,
	onClick,
}: {
	assignment: ChangePolicyAssignmentWithDetails;
	t: ReturnType<typeof useTranslate>["t"];
	onClick: (assignment: ChangePolicyAssignmentWithDetails) => void;
}) {
	return (
		<Button
			variant="ghost"
			size="icon"
			className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
			onClick={() => onClick(assignment)}
			aria-label={t("settings.changePolicies.removeAssignmentFor", "Remove assignment for {name}", {
				name: getAssignmentTargetLabel(assignment, t),
			})}
		>
			<IconTrash className="size-4" aria-hidden="true" />
		</Button>
	);
}

function AssignedPolicySummary({
	policy,
	t,
}: {
	policy: ChangePolicyAssignmentWithDetails["policy"];
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm sm:ml-7">
			<Badge variant="outline" className="max-w-full truncate text-xs" title={policy?.name}>
				{policy?.name}
			</Badge>
			{policy?.noApprovalRequired && (
				<Badge variant="secondary" className="text-xs">
					{t("settings.changePolicies.trustMode", "Trust Mode")}
				</Badge>
			)}
			<span className="text-muted-foreground">{formatPolicySummary(policy, t)}</span>
		</div>
	);
}

interface AssignmentViewArgs {
	canManage: boolean;
	t: ReturnType<typeof useTranslate>["t"];
	onAssignClick: (type: "organization" | "team" | "employee") => void;
	orgAssignment: ChangePolicyAssignmentWithDetails | null;
	teamAssignments: ChangePolicyAssignmentWithDetails[];
	employeeAssignments: ChangePolicyAssignmentWithDetails[];
	handleDeleteClick: (assignment: ChangePolicyAssignmentWithDetails) => void;
	deleteDialogOpen: boolean;
	setDeleteDialogOpen: (open: boolean) => void;
	selectedAssignment: ChangePolicyAssignmentWithDetails | null;
	handleDeleteConfirm: () => void;
	deletePending: boolean;
	deleteError: string | null;
}

const renderAssignmentView = ({
	canManage,
	t,
	onAssignClick,
	orgAssignment,
	teamAssignments,
	employeeAssignments,
	handleDeleteClick,
	deleteDialogOpen,
	setDeleteDialogOpen,
	selectedAssignment,
	handleDeleteConfirm,
	deletePending,
	deleteError,
}: AssignmentViewArgs) => (
	<>
		<div className="space-y-6">
			<div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
				<IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.changePolicies.inheritanceInfo",
						"Policies are applied in priority order: Employee overrides take precedence over Team overrides, which take precedence over the Organization Default. If no policy is assigned at any level, employees can edit their time entries without restrictions.",
					)}
				</p>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<IconBuilding className="size-5 text-muted-foreground" />
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
						<div className="rounded-lg border bg-accent/30 p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 items-start gap-3">
									<IconShieldCheck
										className="mt-0.5 size-4 shrink-0 text-primary"
										aria-hidden="true"
									/>
									<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
										<span className="min-w-0 truncate font-medium" title={orgAssignment.policy?.name}>
											{orgAssignment.policy?.name}
										</span>
										{orgAssignment.policy?.noApprovalRequired && (
											<Badge variant="outline" className="text-xs">
												{t("settings.changePolicies.trustMode", "Trust Mode")}
											</Badge>
										)}
										<span className="text-sm text-muted-foreground">
											{formatPolicySummary(orgAssignment.policy, t)}
										</span>
									</div>
								</div>
								{canManage ? (
									<RemoveAssignmentButton
										assignment={orgAssignment}
										t={t}
										onClick={handleDeleteClick}
									/>
								) : null}
							</div>
						</div>
					) : (
						<div className="space-y-4">
							<div className="flex items-center gap-3 p-4 rounded-lg border border-dashed">
								<IconLock className="size-5 text-muted-foreground" />
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
							{canManage ? (
								<div className="flex justify-end">
									<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
										<IconPlus className="mr-2 size-4" />
										{t("settings.changePolicies.setOrgDefault", "Set Organization Default")}
									</Button>
								</div>
							) : null}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<AssignmentLevelCardHeader
					icon={IconUsers}
					title={t("settings.changePolicies.teamOverrides", "Team Overrides")}
					description={t(
									"settings.changePolicies.teamOverridesDescription",
									"Override the organization default for specific teams (e.g., different departments or work schedules).",
								)}
					count={teamAssignments.length}
				/>
				<CardContent>
					{canManage ? (
						<div className="flex justify-end mb-4">
							<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
								<IconPlus className="mr-2 size-4" />
								{t("settings.changePolicies.assignToTeam", "Assign to Team")}
							</Button>
						</div>
					) : null}
					{teamAssignments.length > 0 ? (
						<div className="space-y-3">
							{teamAssignments.map((assignment) => (
								<div key={assignment.id} className="rounded-lg border p-4">
									<div className="flex items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<IconUsers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
											<span
												className="min-w-0 truncate font-medium"
												title={getAssignmentTargetLabel(assignment, t)}
											>
												{getAssignmentTargetLabel(assignment, t)}
											</span>
										</div>
										{canManage ? (
											<RemoveAssignmentButton
												assignment={assignment}
												t={t}
												onClick={handleDeleteClick}
											/>
										) : null}
									</div>
									<AssignedPolicySummary policy={assignment.policy} t={t} />
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

			<Card>
				<AssignmentLevelCardHeader
					icon={IconUser}
					title={t("settings.changePolicies.employeeOverrides", "Employee Overrides")}
					description={t(
									"settings.changePolicies.employeeOverridesDescription",
									"Override team or organization defaults for specific employees (e.g., special arrangements).",
								)}
					count={employeeAssignments.length}
				/>
				<CardContent>
					{canManage ? (
						<div className="flex justify-end mb-4">
							<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
								<IconPlus className="mr-2 size-4" />
								{t("settings.changePolicies.assignToEmployee", "Assign to Employee")}
							</Button>
						</div>
					) : null}
					{employeeAssignments.length > 0 ? (
						<div className="space-y-3">
							{employeeAssignments.map((assignment) => (
								<div key={assignment.id} className="rounded-lg border p-4">
									<div className="flex items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<IconUser className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
											<span
												className="min-w-0 truncate font-medium"
												title={getAssignmentTargetLabel(assignment, t)}
											>
												{getAssignmentTargetLabel(assignment, t)}
											</span>
										</div>
										{canManage ? (
											<RemoveAssignmentButton
												assignment={assignment}
												t={t}
												onClick={handleDeleteClick}
											/>
										) : null}
									</div>
									<AssignedPolicySummary policy={assignment.policy} t={t} />
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

		<ConfirmActionDialog
			open={canManage && deleteDialogOpen}
			onOpenChange={setDeleteDialogOpen}
			title={t("settings.changePolicies.removeAssignmentTitle", "Remove Policy Assignment?")}
			description={
				<>
					{selectedAssignment?.assignmentType === "organization" &&
						(selectedAssignment.policy?.name
							? t(
									"settings.changePolicies.removeOrgNamedDescription",
									'This will remove "{policy}" as the organization default policy. Employees will have no restrictions unless they have a team or individual override.',
									{ policy: selectedAssignment.policy.name },
								)
							: t(
									"settings.changePolicies.removeOrgDescription",
									"This will remove the organization default policy. Employees will have no restrictions unless they have a team or individual override.",
								))}
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
							{ name: getEmployeeName(selectedAssignment.employee, t) },
						)}
				</>
			}
			confirmLabel={t("common.remove", "Remove")}
			pendingLabel={t("common.removing", "Removing…")}
			isPending={deletePending}
			error={deleteError}
			onConfirm={handleDeleteConfirm}
		/>
	</>
);

export function ChangePolicyAssignmentManager({
	canManage,
	organizationId,
	onAssignClick,
}: ChangePolicyAssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<ChangePolicyAssignmentWithDetails | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const {
		data: assignments,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: queryKeys.changePolicies.assignments(organizationId),
		queryFn: async () => {
			const result = await getChangePolicyAssignments();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data;
		},
		staleTime: 30 * 1000,
	});

	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteChangePolicyAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.changePolicies.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.changePolicies.assignments(organizationId),
				});
				setDeleteDialogOpen(false);
			} else {
				// The dialog stays open with the reason so the removal can be retried.
				setDeleteError(
					actionErrorMessage(t, result, {}, [
						"settings.changePolicies.assignmentDeleteFailed",
						"Failed to remove assignment",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(
				t("settings.changePolicies.assignmentDeleteFailed", "Failed to remove assignment"),
			);
		},
	});

	const handleDeleteClick = (assignment: ChangePolicyAssignmentWithDetails) => {
		setSelectedAssignment(assignment);
		setDeleteError(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedAssignment && !deleteMutation.isPending) {
			setDeleteError(null);
			deleteMutation.mutate(selectedAssignment.id);
		}
	};

	const orgAssignment = assignments?.find((a) => a.assignmentType === "organization") ?? null;
	const teamAssignments = assignments?.filter((a) => a.assignmentType === "team") ?? [];
	const employeeAssignments = assignments?.filter((a) => a.assignmentType === "employee") ?? [];

	if (isLoading) {
		return <AssignmentManagerSkeleton />;
	}

	if (error) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-4 py-8 text-center">
					<p role="alert" className="text-destructive">
						{t("settings.changePolicies.assignmentsLoadError", "Failed to load policy assignments")}
					</p>
					<Button variant="outline" onClick={() => refetch()}>
						<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						{t("common.retry", "Retry")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	return renderAssignmentView({
		canManage,
		t,
		onAssignClick,
		orgAssignment,
		teamAssignments,
		employeeAssignments,
		handleDeleteClick,
		deleteDialogOpen,
		setDeleteDialogOpen,
		selectedAssignment,
		handleDeleteConfirm,
		deletePending: deleteMutation.isPending,
		deleteError,
	});
}
