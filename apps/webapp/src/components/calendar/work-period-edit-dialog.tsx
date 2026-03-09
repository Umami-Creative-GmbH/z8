"use client";

import { IconScissors, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useReducer } from "react";
import { toast } from "sonner";
import {
	updateWorkPeriodNotes,
	updateWorkPeriodProject,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarEvent } from "@/lib/calendar/types";
import { useProjectsEnabled } from "@/stores/organization-settings-store";
import { getWorkPeriodDialogMetadata } from "./work-period-dialog-utils";
import {
	ApprovalStatusBanner,
	NotesEditSection,
	ProjectEditSection,
	WorkPeriodDurationSection,
	WorkPeriodHeader,
	WorkPeriodSummaryBlock,
} from "./work-period-edit-sections";

interface WorkPeriodEditDialogProps {
	event: CalendarEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNotesUpdated?: () => void;
	onSplitClick?: () => void;
	onDeleteClick?: () => void;
}

interface WorkPeriodEditState {
	isEditingNotes: boolean;
	notes: string;
	isSavingNotes: boolean;
	isEditingProject: boolean;
	selectedProjectId: string | undefined;
	isSavingProject: boolean;
}

type WorkPeriodEditAction =
	| { type: "startNotesEdit"; notes: string }
	| { type: "cancelNotesEdit"; notes: string }
	| { type: "setNotes"; notes: string }
	| { type: "setSavingNotes"; value: boolean }
	| { type: "finishNotesEdit" }
	| { type: "startProjectEdit"; projectId: string | undefined }
	| { type: "cancelProjectEdit"; projectId: string | undefined }
	| { type: "setProjectId"; projectId: string | undefined }
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
			return { ...state, isEditingProject: true, selectedProjectId: action.projectId };
		case "cancelProjectEdit":
			return { ...state, isEditingProject: false, selectedProjectId: action.projectId };
		case "setProjectId":
			return { ...state, selectedProjectId: action.projectId };
		case "setSavingProject":
			return { ...state, isSavingProject: action.value };
		case "finishProjectEdit":
			return { ...state, isEditingProject: false };
	}
}

export function WorkPeriodEditDialog({
	event,
	open,
	onOpenChange,
	onNotesUpdated,
	onSplitClick,
	onDeleteClick,
}: WorkPeriodEditDialogProps) {
	const { t } = useTranslate();
	const projectsEnabled = useProjectsEnabled();
	const metadata = getWorkPeriodDialogMetadata(event);
	const approvalStatus = metadata.approvalStatus ?? "approved";
	const [state, dispatch] = useReducer(workPeriodEditReducer, metadata, createInitialState);

	const handleSaveNotes = useCallback(async () => {
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
	}, [event.id, onNotesUpdated, state.notes, t]);

	const handleSaveProject = useCallback(async () => {
		dispatch({ type: "setSavingProject", value: true });
		const result = await updateWorkPeriodProject(event.id, state.selectedProjectId ?? null).catch(
			() => null,
		);

		if (!result) {
			toast.error(t("calendar.edit.projectSaveFailed", "Failed to update project"));
		} else if (!result.success) {
			toast.error(result.error || t("calendar.edit.projectSaveFailed", "Failed to update project"));
		} else {
			toast.success(t("calendar.edit.projectSaved", "Project updated"));
			onNotesUpdated?.();
			dispatch({ type: "finishProjectEdit" });
		}

		dispatch({ type: "setSavingProject", value: false });
	}, [event.id, onNotesUpdated, state.selectedProjectId, t]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						<WorkPeriodHeader event={event} status={approvalStatus} t={t} />
					</DialogTitle>
					<DialogDescription />
				</DialogHeader>

				<div className="space-y-4 py-4">
					<ApprovalStatusBanner status={approvalStatus} t={t} />
					<WorkPeriodSummaryBlock event={event} metadata={metadata} t={t} />
					<WorkPeriodDurationSection metadata={metadata} t={t} />
					<ProjectEditSection
						projectsEnabled={projectsEnabled}
						metadata={metadata}
						isEditing={state.isEditingProject}
						selectedProjectId={state.selectedProjectId}
						isSaving={state.isSavingProject}
						onStartEdit={() =>
							dispatch({ type: "startProjectEdit", projectId: metadata.projectId })
						}
						onCancel={() => dispatch({ type: "cancelProjectEdit", projectId: metadata.projectId })}
						onSave={handleSaveProject}
						onProjectChange={(projectId) => dispatch({ type: "setProjectId", projectId })}
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
				</div>

				<DialogFooter className="flex-col gap-2 sm:flex-row">
					<div className="flex w-full gap-2 sm:w-auto">
						<Button
							variant="outline"
							size="sm"
							onClick={onSplitClick}
							disabled={!onSplitClick}
							className="flex-1 sm:flex-none"
						>
							<IconScissors className="mr-1 size-4" />
							{t("calendar.edit.split", "Split")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onDeleteClick}
							disabled={!onDeleteClick}
							className="flex-1 text-destructive hover:text-destructive sm:flex-none"
						>
							<IconTrash className="mr-1 size-4" />
							{t("calendar.edit.convertToBreak", "Convert to Break")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
