"use client";

import { IconScissors, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useReducer } from "react";
import { toast } from "sonner";
import {
	updateWorkPeriodNotes,
	updateWorkPeriodProject,
} from "@/app/[locale]/(app)/time-tracking/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { DisplayContext } from "@/lib/datetime/temporal-format";
import { projectTaskRefusalMessage } from "@/lib/projects/project-task-model";
import { chooseProject, taskIdToSend } from "@/lib/time-tracking/task-attribution";
import { useProjectsEnabled } from "@/stores/organization-settings-store";
import { formatWorkPeriodEditedBy, getWorkPeriodDialogMetadata } from "./work-period-dialog-utils";
import {
	ApprovalStatusBanner,
	NotesEditSection,
	ProjectEditSection,
	WorkPeriodDurationSection,
	WorkPeriodHeader,
	WorkPeriodSummaryBlock,
} from "./work-period-edit-sections";
import { WorkPeriodTimeSection } from "./work-period-time-edit-section";

interface WorkPeriodEditDialogProps {
	event: CalendarEvent;
	/**
	 * Whether the signed-in employee may change the project and task: only on their
	 * own work, whose bookable projects and tasks are the ones the picker offers.
	 */
	canChangeProject: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNotesUpdated?: () => void;
	onTimesUpdated?: () => void;
	onSplitClick?: () => void;
	onDeleteClick?: () => void;
	displayContext: DisplayContext;
	/** Open the time form right away (context menu "Edit"). */
	initialTimeEditing?: boolean;
}

interface WorkPeriodEditState {
	isEditingNotes: boolean;
	notes: string;
	isSavingNotes: boolean;
	isEditingProject: boolean;
	selectedProjectId: string | undefined;
	/** A task of the selected project (#874); cleared when the project changes. */
	selectedTaskId: string | undefined;
	isSavingProject: boolean;
}

type WorkPeriodEditAction =
	| { type: "startNotesEdit"; notes: string }
	| { type: "cancelNotesEdit"; notes: string }
	| { type: "setNotes"; notes: string }
	| { type: "setSavingNotes"; value: boolean }
	| { type: "finishNotesEdit" }
	| { type: "startProjectEdit"; projectId: string | undefined; taskId: string | undefined }
	| { type: "cancelProjectEdit"; projectId: string | undefined; taskId: string | undefined }
	| { type: "setProjectId"; projectId: string | undefined }
	| { type: "setTaskId"; taskId: string | undefined }
	| { type: "setSavingProject"; value: boolean }
	| { type: "finishProjectEdit" };

function createInitialState(
	metadata: ReturnType<typeof getWorkPeriodDialogMetadata>,
): WorkPeriodEditState {
	return {
		isEditingNotes: false,
		notes: metadata.notes || "",
		isSavingNotes: false,
		isEditingProject: false,
		selectedProjectId: metadata.projectId,
		selectedTaskId: metadata.taskId,
		isSavingProject: false,
	};
}

function workPeriodEditReducer(
	state: WorkPeriodEditState,
	action: WorkPeriodEditAction,
): WorkPeriodEditState {
	switch (action.type) {
		case "startNotesEdit":
			return { ...state, isEditingNotes: true, notes: action.notes };
		case "cancelNotesEdit":
			return { ...state, isEditingNotes: false, notes: action.notes };
		case "setNotes":
			return { ...state, notes: action.notes };
		case "setSavingNotes":
			return { ...state, isSavingNotes: action.value };
		case "finishNotesEdit":
			return { ...state, isEditingNotes: false };
		case "startProjectEdit":
			return {
				...state,
				isEditingProject: true,
				selectedProjectId: action.projectId,
				selectedTaskId: action.taskId,
			};
		case "cancelProjectEdit":
			return {
				...state,
				isEditingProject: false,
				selectedProjectId: action.projectId,
				selectedTaskId: action.taskId,
			};
		case "setProjectId": {
			// A task never outlives its project (#874).
			const { projectId, taskId } = chooseProject(
				{ projectId: state.selectedProjectId, taskId: state.selectedTaskId },
				action.projectId,
			);
			return { ...state, selectedProjectId: projectId, selectedTaskId: taskId };
		}
		case "setTaskId":
			return { ...state, selectedTaskId: action.taskId };
		case "setSavingProject":
			return { ...state, isSavingProject: action.value };
		case "finishProjectEdit":
			return { ...state, isEditingProject: false };
	}
}

export function WorkPeriodEditDialog({
	event,
	canChangeProject,
	open,
	onOpenChange,
	onNotesUpdated,
	onTimesUpdated,
	onSplitClick,
	onDeleteClick,
	displayContext,
	initialTimeEditing = false,
}: WorkPeriodEditDialogProps) {
	const { t } = useTranslate();
	const projectsEnabled = useProjectsEnabled();
	const metadata = getWorkPeriodDialogMetadata(event);
	const editedBy = formatWorkPeriodEditedBy(event, displayContext.timezone, t);
	const approvalStatus = metadata.approvalStatus ?? "approved";
	const [state, dispatch] = useReducer(workPeriodEditReducer, metadata, createInitialState);

	const handleSaveNotes = async () => {
		dispatch({ type: "setSavingNotes", value: true });
		const result = await updateWorkPeriodNotes(event.id, state.notes.trim()).catch(() => null);

		if (!result) {
			toast.error(t("calendar.edit.notesSaveFailed", "Failed to save notes"));
		} else if (!result.success) {
			toast.error(result.error || t("calendar.edit.notesSaveFailed", "Failed to save notes"));
		} else {
			toast.success(t("calendar.edit.notesSaved", "Notes saved"));
			onNotesUpdated?.();
			dispatch({ type: "finishNotesEdit" });
		}

		dispatch({ type: "setSavingNotes", value: false });
	};

	const handleSaveProject = async () => {
		dispatch({ type: "setSavingProject", value: true });
		// An unchanged task is left to the server (it may be done by now); any other choice is explicit.
		const result = await updateWorkPeriodProject(
			event.id,
			state.selectedProjectId ?? null,
			taskIdToSend({
				projectId: state.selectedProjectId,
				taskId: state.selectedTaskId,
				current: { projectId: metadata.projectId, taskId: metadata.taskId },
			}),
		).catch(() => null);

		if (!result) {
			toast.error(t("calendar.edit.projectSaveFailed", "Failed to update project"));
		} else if (!result.success) {
			const taskRefusal = projectTaskRefusalMessage("code" in result ? result.code : null);
			toast.error(
				taskRefusal
					? t(taskRefusal[0], taskRefusal[1])
					: result.error || t("calendar.edit.projectSaveFailed", "Failed to update project"),
			);
		} else {
			toast.success(t("calendar.edit.projectSaved", "Project updated"));
			onNotesUpdated?.();
			dispatch({ type: "finishProjectEdit" });
		}

		dispatch({ type: "setSavingProject", value: false });
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="compact">
				<ActionPanelHeader>
					<ActionPanelTitle>
						<WorkPeriodHeader
							event={event}
							status={approvalStatus}
							t={t}
							displayContext={displayContext}
						/>
					</ActionPanelTitle>
					<ActionPanelDescription />
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-4">
					<ApprovalStatusBanner status={approvalStatus} t={t} />
					<WorkPeriodSummaryBlock metadata={metadata} t={t} />
					<WorkPeriodTimeSection
						event={event}
						displayContext={displayContext}
						onTimesUpdated={onTimesUpdated}
						initialEditing={initialTimeEditing}
						t={t}
					/>
					{editedBy ? <p className="text-xs italic text-muted-foreground">{editedBy}</p> : null}
					<WorkPeriodDurationSection metadata={metadata} t={t} />
					<ProjectEditSection
						projectsEnabled={projectsEnabled}
						canEdit={canChangeProject}
						metadata={metadata}
						isEditing={state.isEditingProject}
						selectedProjectId={state.selectedProjectId}
						selectedTaskId={state.selectedTaskId}
						isSaving={state.isSavingProject}
						onStartEdit={() =>
							dispatch({
								type: "startProjectEdit",
								projectId: metadata.projectId,
								taskId: metadata.taskId,
							})
						}
						onCancel={() =>
							dispatch({
								type: "cancelProjectEdit",
								projectId: metadata.projectId,
								taskId: metadata.taskId,
							})
						}
						onSave={handleSaveProject}
						onProjectChange={(projectId) => dispatch({ type: "setProjectId", projectId })}
						onTaskChange={(taskId) => dispatch({ type: "setTaskId", taskId })}
						t={t}
					/>
					<NotesEditSection
						notes={state.notes}
						isEditing={state.isEditingNotes}
						isSaving={state.isSavingNotes}
						onNotesChange={(notes) => dispatch({ type: "setNotes", notes })}
						onStartEdit={() => dispatch({ type: "startNotesEdit", notes: metadata.notes || "" })}
						onCancel={() => dispatch({ type: "cancelNotesEdit", notes: metadata.notes || "" })}
						onSave={handleSaveNotes}
						t={t}
					/>
				</ActionPanelBody>

				<ActionPanelFooter className="flex-col gap-2 sm:flex-row">
					<div className="flex w-full gap-2 sm:w-auto">
						<Button
							variant="outline"
							size="sm"
							onClick={onSplitClick}
							disabled={!onSplitClick}
							className="flex-1 sm:flex-none"
						>
							<IconScissors className="mr-1 size-4" aria-hidden="true" />
							{t("calendar.edit.split", "Split")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onDeleteClick}
							disabled={!onDeleteClick}
							className="flex-1 text-destructive hover:text-destructive sm:flex-none"
						>
							<IconTrash className="mr-1 size-4" aria-hidden="true" />
							{t("calendar.edit.deleteEntry", "Delete entry")}
						</Button>
					</div>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
