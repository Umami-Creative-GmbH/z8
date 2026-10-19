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
import { AssignmentLevelCardHeader } from "@/components/settings/assignment-level-card-header";
import { AssignmentManagerSkeleton } from "@/components/settings/assignment-manager-skeleton";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
			const result = await getWorkCategorySetAssignments(organizationId);
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

	const deleteMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteSetAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workCategories.assignmentDeleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategorySetAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t("settings.workCategories.assignmentDeleteFailed", "Failed to remove assignment"),
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

	return {
		deleteDialogOpen,
		setDeleteDialogOpen,
		selectedAssignment,
		isDeleting: deleteMutation.isPending,
		handleDeleteClick,
		handleDeleteConfirm,
	};
}

function RemoveAssignmentButton({
	canManage,
	onClick,
}: {
	canManage: boolean;
	onClick: () => void;
}) {
	const { t } = useTranslate();

	return canManage ? (
		<Button
			variant="ghost"
			size="icon"
			className="size-8 text-muted-foreground hover:text-destructive"
			onClick={onClick}
			aria-label={t("common.remove", "Remove")}
		>
			<IconTrash className="size-4" />
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
				<div className="flex items-center justify-between mb-2">
					<h4 className="text-sm font-medium text-muted-foreground">
						{t("settings.workCategories.defaultSet", "Default Category Set")}
					</h4>
					{canManage && !assignment && (
						<Button onClick={onAssignClick} size="sm" variant="outline">
							<IconPlus className="mr-2 size-4" />
							{t("settings.workCategories.setDefault", "Set Default")}
						</Button>
					)}
				</div>
				{assignment ? (
					<div className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
						<div className="flex items-center gap-3">
							<IconTag className="size-4 text-muted-foreground" />
							<div>
								<span className="font-medium">{assignment.set.name}</span>
								{assignment.set.description && (
									<p className="text-sm text-muted-foreground">{assignment.set.description}</p>
								)}
							</div>
						</div>
						<RemoveAssignmentButton
							canManage={canManage}
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
								className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
							>
								<div className="flex items-center gap-3">
									<IconUsers className="size-4 text-muted-foreground" />
									<div>
										<span className="font-medium">{assignment.team?.name}</span>
										<span className="text-muted-foreground mx-2">→</span>
										<span className="text-sm">{assignment.set.name}</span>
									</div>
								</div>
								<RemoveAssignmentButton
									canManage={canManage}
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
								className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
							>
								<div className="flex items-center gap-3">
									<IconUser className="size-4 text-muted-foreground" />
									<div>
										<span className="font-medium">
											{assignment.employee?.firstName} {assignment.employee?.lastName}
										</span>
										<span className="text-muted-foreground mx-2">→</span>
										<span className="text-sm">{assignment.set.name}</span>
									</div>
								</div>
								<RemoveAssignmentButton
									canManage={canManage}
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
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedAssignment: AssignmentData | null;
	isDeleting: boolean;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
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
					<AlertDialogCancel disabled={isDeleting}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						disabled={isDeleting}
						className="bg-destructive hover:bg-destructive/90"
					>
						{isDeleting ? (
							<>
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("common.removing", "Removing...")}
							</>
						) : (
							t("common.remove", "Remove")
						)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function WorkCategoryAssignmentManager({
	organizationId,
	canManage,
	onAssignClick,
}: WorkCategoryAssignmentManagerProps) {
	const { t } = useTranslate();
	const { data: assignments, isLoading, error } = useWorkCategoryAssignments(organizationId);
	const deletion = useWorkCategoryAssignmentDeletion(organizationId);

	if (isLoading) {
		return <AssignmentManagerSkeleton />;
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
				onConfirm={deletion.handleDeleteConfirm}
			/>
		</>
	);
}
