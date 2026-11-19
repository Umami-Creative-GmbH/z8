"use client";

import {
	IconBuilding,
	IconPlus,
	IconRefresh,
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
import { AssignmentLevelCardHeader } from "@/components/settings/assignment-level-card-header";
import { AssignmentManagerSkeleton } from "@/components/settings/assignment-manager-skeleton";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";

type AssignmentType = "organization" | "team" | "employee";

interface WorkCategoryAssignmentManagerProps {
	organizationId: string;
	canManage: boolean;
	onAssignClick: (type: AssignmentType) => void;
}

interface AssignmentData {
	id: string;
	setId: string;
	organizationId: string;
	assignmentType: AssignmentType;
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

interface AssignmentLevelProps {
	canManage: boolean;
	onAssignClick: () => void;
	onDeleteClick: (assignment: AssignmentData) => void;
}

function useWorkCategoryAssignments(organizationId: string) {
	return useQuery({
		queryKey: queryKeys.workCategorySetAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getWorkCategorySetAssignments();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as AssignmentData[];
		},
	});
}

function useWorkCategoryAssignmentDeletion(organizationId: string) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] = useState<AssignmentData | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteSetAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workCategories.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategorySetAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
			} else {
				// The dialog stays open with the reason so the removal can be retried.
				setDeleteError(
					actionErrorMessage(t, result, {}, [
						"settings.workCategories.assignmentDeleteFailed",
						"Failed to remove assignment",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(
				t("settings.workCategories.assignmentDeleteFailed", "Failed to remove assignment"),
			);
		},
	});

	const handleDeleteClick = (assignment: AssignmentData) => {
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

	const handleOpenChange = (open: boolean) => {
		setDeleteDialogOpen(open);
		if (!open) setDeleteError(null);
	};

	return {
		deleteDialogOpen,
		setDeleteDialogOpen: handleOpenChange,
		selectedAssignment,
		deleteError,
		isDeleting: deleteMutation.isPending,
		handleDeleteClick,
		handleDeleteConfirm,
	};
}

function formatAssignmentEmployeeName(employee: AssignmentData["employee"]) {
	return [employee?.firstName, employee?.lastName].filter(Boolean).join(" ");
}

function RemoveAssignmentButton({
	canManage,
	label,
	onClick,
}: {
	canManage: boolean;
	label: string;
	onClick: () => void;
}) {
	const { t } = useTranslate();

	return canManage ? (
		<Button
			variant="ghost"
			size="icon"
			className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
			onClick={onClick}
			aria-label={t("settings.workCategories.removeAssignmentFor", "Remove assignment for {name}", {
				name: label,
			})}
		>
			<IconTrash className="size-4" aria-hidden="true" />
		</Button>
	) : null;
}

function OrganizationAssignmentCard({
	assignment,
	canManage,
	onAssignClick,
	onDeleteClick,
}: AssignmentLevelProps & { assignment: AssignmentData | undefined }) {
	const { t } = useTranslate();

	return (
		<Card>
			<AssignmentLevelCardHeader
				icon={IconBuilding}
				title={t("settings.workCategories.orgLevel", "Organization Default")}
				description={t(
					"settings.workCategories.orgLevelDescription",
					"Default category set applied to all employees unless overridden",
				)}
			/>
			<CardContent>
				<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
					<h4 className="text-sm font-medium text-muted-foreground">
						{t("settings.workCategories.defaultSet", "Default Category Set")}
					</h4>
					{canManage && !assignment && (
						<Button onClick={onAssignClick} size="sm" variant="outline">
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.workCategories.setDefault", "Set Default")}
						</Button>
					)}
				</div>
				{assignment ? (
					<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
						<div className="flex min-w-0 items-center gap-3">
							<IconTag className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<div className="min-w-0">
								<span className="block truncate font-medium" title={assignment.set.name}>
									{assignment.set.name}
								</span>
								{assignment.set.description && (
									<p className="break-words text-sm text-muted-foreground">
										{assignment.set.description}
									</p>
								)}
							</div>
						</div>
						<RemoveAssignmentButton
							canManage={canManage}
							label={t("settings.workCategories.orgLevel", "Organization Default")}
							onClick={() => onDeleteClick(assignment)}
						/>
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
	);
}

function AssignButton({
	canManage,
	label,
	onClick,
}: {
	canManage: boolean;
	label: string;
	onClick: () => void;
}) {
	return canManage ? (
		<div className="flex justify-end mb-2">
			<Button onClick={onClick} size="sm" variant="outline">
				<IconPlus className="mr-2 size-4" />
				{label}
			</Button>
		</div>
	) : null;
}

function TeamAssignmentsCard({
	assignments,
	canManage,
	onAssignClick,
	onDeleteClick,
}: AssignmentLevelProps & { assignments: AssignmentData[] }) {
	const { t } = useTranslate();

	return (
		<Card>
			<AssignmentLevelCardHeader
				icon={IconUsers}
				title={t("settings.workCategories.teamLevel", "Team Level")}
				description={t(
					"settings.workCategories.teamLevelDescription",
					"Override organization default for specific teams",
				)}
				count={assignments.length}
			/>
			<CardContent>
				<AssignButton
					canManage={canManage}
					label={t("settings.workCategories.assignTeam", "Assign to Team")}
					onClick={onAssignClick}
				/>
				{assignments.length > 0 ? (
					<div className="space-y-2">
						{assignments.map((assignment) => (
							<div
								key={assignment.id}
								className="flex items-center justify-between gap-3 rounded-lg border p-3"
							>
								<div className="flex min-w-0 items-center gap-3">
									<IconUsers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<div className="min-w-0 break-words">
										<span className="font-medium">
											{assignment.team?.name ?? t("common.unknownTeam", "Unknown Team")}
										</span>
										<span className="mx-2 text-muted-foreground" aria-hidden="true">
											→
										</span>
										<span className="text-sm">{assignment.set.name}</span>
									</div>
								</div>
								<RemoveAssignmentButton
									canManage={canManage}
									label={assignment.team?.name ?? t("common.unknownTeam", "Unknown Team")}
									onClick={() => onDeleteClick(assignment)}
								/>
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">
						{t("settings.workCategories.noTeamAssignments", "No team-level assignments")}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function EmployeeAssignmentsCard({
	assignments,
	canManage,
	onAssignClick,
	onDeleteClick,
}: AssignmentLevelProps & { assignments: AssignmentData[] }) {
	const { t } = useTranslate();

	return (
		<Card>
			<AssignmentLevelCardHeader
				icon={IconUser}
				title={t("settings.workCategories.employeeLevel", "Employee Overrides")}
				description={t(
					"settings.workCategories.employeeLevelDescription",
					"Override team or organization defaults for specific employees",
				)}
				count={assignments.length}
			/>
			<CardContent>
				<AssignButton
					canManage={canManage}
					label={t("settings.workCategories.assignEmployee", "Assign to Employee")}
					onClick={onAssignClick}
				/>
				{assignments.length > 0 ? (
					<div className="space-y-2">
						{assignments.map((assignment) => (
							<div
								key={assignment.id}
								className="flex items-center justify-between gap-3 rounded-lg border p-3"
							>
								<div className="flex min-w-0 items-center gap-3">
									<IconUser className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<div className="min-w-0 break-words">
										<span className="font-medium">
											{formatAssignmentEmployeeName(assignment.employee) ||
												t("common.unknownEmployee", "Unknown Employee")}
										</span>
										<span className="mx-2 text-muted-foreground" aria-hidden="true">
											→
										</span>
										<span className="text-sm">{assignment.set.name}</span>
									</div>
								</div>
								<RemoveAssignmentButton
									canManage={canManage}
									label={
										formatAssignmentEmployeeName(assignment.employee) ||
										t("common.unknownEmployee", "Unknown Employee")
									}
									onClick={() => onDeleteClick(assignment)}
								/>
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">
						{t("settings.workCategories.noEmployeeAssignments", "No employee-level overrides")}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function DeleteAssignmentDialog({
	open,
	onOpenChange,
	selectedAssignment,
	isDeleting,
	error,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedAssignment: AssignmentData | null;
	isDeleting: boolean;
	error: string | null;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();

	return (
		<ConfirmActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("settings.workCategories.deleteAssignmentTitle", "Remove Assignment?")}
			description={
				<>
					{selectedAssignment?.assignmentType === "organization" &&
						t(
							"settings.workCategories.deleteOrgAssignmentNamed",
							'This will remove "{set}" as the organization default. Employees will not have work categories available unless assigned individually.',
							{ set: selectedAssignment.set.name },
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
								name:
									formatAssignmentEmployeeName(selectedAssignment.employee) ||
									t("common.unknownEmployee", "Unknown Employee"),
							},
						)}
				</>
			}
			confirmLabel={t("common.remove", "Remove")}
			pendingLabel={t("common.removing", "Removing...")}
			isPending={isDeleting}
			error={error}
			onConfirm={onConfirm}
		/>
	);
}

export function WorkCategoryAssignmentManager({
	organizationId,
	canManage,
	onAssignClick,
}: WorkCategoryAssignmentManagerProps) {
	const { t } = useTranslate();
	const {
		data: assignments,
		isLoading,
		error,
		refetch,
	} = useWorkCategoryAssignments(organizationId);
	const deletion = useWorkCategoryAssignmentDeletion(organizationId);

	if (isLoading) {
		return <AssignmentManagerSkeleton />;
	}

	if (error) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-4 py-8 text-center">
					<p role="alert" className="text-destructive">
						{t("settings.workCategories.assignmentsLoadError", "Failed to load assignments")}
					</p>
					<Button variant="outline" onClick={() => refetch()}>
						<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						{t("common.retry", "Retry")}
					</Button>
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
				<OrganizationAssignmentCard
					assignment={orgAssignment}
					canManage={canManage}
					onAssignClick={() => onAssignClick("organization")}
					onDeleteClick={deletion.handleDeleteClick}
				/>
				<TeamAssignmentsCard
					assignments={teamAssignments}
					canManage={canManage}
					onAssignClick={() => onAssignClick("team")}
					onDeleteClick={deletion.handleDeleteClick}
				/>
				<EmployeeAssignmentsCard
					assignments={employeeAssignments}
					canManage={canManage}
					onAssignClick={() => onAssignClick("employee")}
					onDeleteClick={deletion.handleDeleteClick}
				/>
			</div>

			<DeleteAssignmentDialog
				open={canManage && deletion.deleteDialogOpen}
				onOpenChange={deletion.setDeleteDialogOpen}
				selectedAssignment={deletion.selectedAssignment}
				isDeleting={deletion.isDeleting}
				error={deletion.deleteError}
				onConfirm={deletion.handleDeleteConfirm}
			/>
		</>
	);
}
