"use client";

import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteHolidayAssignment,
	deleteHolidayCategoryAssignment,
	getHolidayAssignments,
	getHolidayCategoryAssignments,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import {
	deletePresetAssignment,
	getPresetAssignments,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import { AssignmentManagerSkeleton } from "@/components/settings/assignment-manager-skeleton";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import type { ServerActionResult } from "@/lib/effect/result";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import {
	EmployeeLevelCard,
	type HolidayAssignmentData,
	type HolidayAssignmentType,
	type HolidayCategoryAssignmentData,
	type HolidayLevelAssignments,
	OrganizationLevelCard,
	type PresetAssignmentData,
	TeamLevelCard,
} from "./assignment-level-cards";

interface AssignmentManagerProps {
	organizationId: string;
	canManage: boolean;
	onAssignClick: (type: HolidayAssignmentType) => void;
	onHolidayAssignClick: (type: HolidayAssignmentType) => void;
}

/** The assignment the delete dialog is confirming the removal of. */
type DeleteSelection =
	| { kind: "preset"; assignment: PresetAssignmentData }
	| { kind: "holiday"; assignment: HolidayAssignmentData }
	| { kind: "category"; assignment: HolidayCategoryAssignmentData };

function groupByLevel<T extends { assignmentType: HolidayAssignmentType }>(
	assignments: T[] | undefined,
	type: HolidayAssignmentType,
) {
	return (assignments || []).filter((a) => a.assignmentType === type);
}

function useHolidayAssignmentData(organizationId: string) {
	const presetQuery = useQuery({
		queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getPresetAssignments();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as PresetAssignmentData[];
		},
	});

	const holidayQuery = useQuery({
		queryKey: queryKeys.holidayAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayAssignments();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch holiday assignments");
			}
			return result.data as HolidayAssignmentData[];
		},
	});

	const categoryQuery = useQuery({
		queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayCategoryAssignments();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch holiday category assignments");
			}
			return result.data as HolidayCategoryAssignmentData[];
		},
	});

	const levelAssignments = (type: HolidayAssignmentType): HolidayLevelAssignments => ({
		presets: groupByLevel(presetQuery.data, type),
		holidays: groupByLevel(holidayQuery.data, type),
		categories: groupByLevel(categoryQuery.data, type),
	});

	return {
		organization: levelAssignments("organization"),
		team: levelAssignments("team"),
		employee: levelAssignments("employee"),
		isLoading: presetQuery.isLoading || holidayQuery.isLoading || categoryQuery.isLoading,
		error: presetQuery.error || holidayQuery.error || categoryQuery.error,
		isRefetching: presetQuery.isFetching || holidayQuery.isFetching || categoryQuery.isFetching,
		/** Retries only the reads that failed. */
		retry: () => {
			if (presetQuery.isError) void presetQuery.refetch();
			if (holidayQuery.isError) void holidayQuery.refetch();
			if (categoryQuery.isError) void categoryQuery.refetch();
		},
	};
}

function useRemoveAssignmentMutation({
	mutationFn,
	queryKey,
	onRemoved,
	onFailed,
	successMessage,
	failureMessage,
}: {
	mutationFn: (assignmentId: string) => Promise<ServerActionResult<unknown>>;
	queryKey: QueryKey;
	onRemoved: () => void;
	onFailed: (message: string) => void;
	successMessage: () => string;
	failureMessage: () => string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn,
		onSuccess: (result) => {
			if (result.success) {
				toast.success(successMessage());
				queryClient.invalidateQueries({ queryKey });
				onRemoved();
			} else {
				onFailed(actionErrorMessage(t, result, {}, () => failureMessage()));
			}
		},
		onError: () => {
			onFailed(failureMessage());
		},
	});
}

function useHolidayAssignmentDeletion(organizationId: string) {
	const { t } = useTranslate();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selection, setSelection] = useState<DeleteSelection | null>(null);
	// A failed removal keeps the dialog open with the reason, so it can be retried.
	const [deleteError, setDeleteError] = useState<string | null>(null);
	// The selection is kept after closing so the text does not blank out while it animates away.
	const onRemoved = () => setDeleteDialogOpen(false);
	const onFailed = (message: string) => setDeleteError(message);

	const deletePresetMutation = useRemoveAssignmentMutation({
		mutationFn: (assignmentId) => deletePresetAssignment(assignmentId),
		queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
		onRemoved,
		onFailed,
		successMessage: () => t("settings.holidays.assignments.deleted", "Assignment removed"),
		failureMessage: () =>
			t("settings.holidays.assignments.deleteFailed", "Failed to remove assignment"),
	});

	const deleteHolidayMutation = useRemoveAssignmentMutation({
		mutationFn: (assignmentId) => deleteHolidayAssignment(assignmentId),
		queryKey: queryKeys.holidayAssignments.list(organizationId),
		onRemoved,
		onFailed,
		successMessage: () =>
			t("settings.holidays.assignments.holidayDeleted", "Holiday assignment removed"),
		failureMessage: () =>
			t("settings.holidays.assignments.holidayDeleteFailed", "Failed to remove holiday assignment"),
	});

	const deleteHolidayCategoryMutation = useRemoveAssignmentMutation({
		mutationFn: (assignmentId) => deleteHolidayCategoryAssignment(assignmentId),
		queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
		onRemoved,
		onFailed,
		successMessage: () =>
			t("settings.holidays.assignments.categoryDeleted", "Holiday category assignment removed"),
		failureMessage: () =>
			t(
				"settings.holidays.assignments.categoryDeleteFailed",
				"Failed to remove holiday category assignment",
			),
	});

	const isDeleting =
		deletePresetMutation.isPending ||
		deleteHolidayMutation.isPending ||
		deleteHolidayCategoryMutation.isPending;

	const select = (next: DeleteSelection) => {
		setSelection(next);
		setDeleteError(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (isDeleting) return;
		setDeleteError(null);
		if (selection?.kind === "preset") {
			deletePresetMutation.mutate(selection.assignment.id);
		} else if (selection?.kind === "holiday") {
			deleteHolidayMutation.mutate(selection.assignment.id);
		} else if (selection?.kind === "category") {
			deleteHolidayCategoryMutation.mutate(selection.assignment.id);
		}
	};

	return {
		deleteDialogOpen,
		setDeleteDialogOpen: (open: boolean) => {
			setDeleteDialogOpen(open);
			if (!open) setDeleteError(null);
		},
		selection,
		deleteError,
		isDeleting,
		handleDeletePresetClick: (assignment: PresetAssignmentData) =>
			select({ kind: "preset", assignment }),
		handleDeleteHolidayClick: (assignment: HolidayAssignmentData) =>
			select({ kind: "holiday", assignment }),
		handleDeleteHolidayCategoryClick: (assignment: HolidayCategoryAssignmentData) =>
			select({ kind: "category", assignment }),
		handleDeleteConfirm,
	};
}

function PresetDeleteDescription({ assignment }: { assignment: PresetAssignmentData }) {
	const { t } = useTranslate();

	return (
		<>
			{assignment.assignmentType === "organization" &&
				t(
					"settings.holidays.assignments.deleteOrgNamedDescription",
					'This will remove "{preset}" as the organization default preset. Employees will only see custom holidays.',
					{ preset: assignment.preset.name },
				)}
			{assignment.assignmentType === "team" &&
				t(
					"settings.holidays.assignments.deleteTeamDescription",
					'This will remove the preset from team "{team}". They will use the organization default.',
					{ team: assignment.team?.name },
				)}
			{assignment.assignmentType === "employee" &&
				t(
					"settings.holidays.assignments.deleteEmployeeDescription",
					'This will remove the override for "{name}". They will use their team or organization default.',
					{
						name: `${assignment.employee?.firstName} ${assignment.employee?.lastName}`,
					},
				)}
		</>
	);
}

function DeleteSelectionDescription({ selection }: { selection: DeleteSelection | null }) {
	const { t } = useTranslate();

	if (selection?.kind === "preset") {
		return <PresetDeleteDescription assignment={selection.assignment} />;
	}
	if (selection?.kind === "holiday") {
		return t(
			"settings.holidays.assignments.deleteHolidayDescription",
			'This will remove the custom holiday "{holiday}" from this assignment.',
			{ holiday: selection.assignment.holiday.name },
		);
	}
	if (selection?.kind === "category") {
		return t(
			"settings.holidays.assignments.deleteHolidayCategoryDescription",
			'This will remove the custom holiday category "{category}" from this assignment.',
			{ category: selection.assignment.category.name },
		);
	}
	return null;
}

function DeleteAssignmentDialog({
	deletion,
}: {
	deletion: ReturnType<typeof useHolidayAssignmentDeletion>;
}) {
	const { t } = useTranslate();

	return (
		<ConfirmActionDialog
			open={deletion.deleteDialogOpen}
			onOpenChange={deletion.setDeleteDialogOpen}
			title={t("settings.holidays.assignments.deleteTitle", "Remove Assignment?")}
			description={<DeleteSelectionDescription selection={deletion.selection} />}
			confirmLabel={t("common.remove", "Remove")}
			pendingLabel={t("common.removing", "Removing...")}
			isPending={deletion.isDeleting}
			error={deletion.deleteError}
			onConfirm={deletion.handleDeleteConfirm}
		/>
	);
}

export function AssignmentManager({
	organizationId,
	canManage,
	onAssignClick,
	onHolidayAssignClick,
}: AssignmentManagerProps) {
	const { t } = useTranslate();
	const data = useHolidayAssignmentData(organizationId);
	const deletion = useHolidayAssignmentDeletion(organizationId);

	if (data.isLoading) {
		return <AssignmentManagerSkeleton />;
	}

	if (data.error) {
		return (
			<SettingsLoadError
				message={t("settings.holidays.assignments.loadError", "Failed to load assignments")}
				onRetry={data.retry}
				isRetrying={data.isRefetching}
			/>
		);
	}

	const deleteHandlers = {
		canManage,
		onDeletePresetClick: deletion.handleDeletePresetClick,
		onDeleteHolidayClick: deletion.handleDeleteHolidayClick,
		onDeleteHolidayCategoryClick: deletion.handleDeleteHolidayCategoryClick,
	};

	return (
		<>
			<div className="space-y-6">
				<OrganizationLevelCard
					assignments={data.organization}
					onAssignPresetClick={() => onAssignClick("organization")}
					onAssignHolidayClick={() => onHolidayAssignClick("organization")}
					{...deleteHandlers}
				/>
				<TeamLevelCard
					assignments={data.team}
					onAssignPresetClick={() => onAssignClick("team")}
					onAssignHolidayClick={() => onHolidayAssignClick("team")}
					{...deleteHandlers}
				/>
				<EmployeeLevelCard
					assignments={data.employee}
					onAssignPresetClick={() => onAssignClick("employee")}
					onAssignHolidayClick={() => onHolidayAssignClick("employee")}
					{...deleteHandlers}
				/>
			</div>

			<DeleteAssignmentDialog deletion={deletion} />
		</>
	);
}
