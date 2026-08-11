"use client";

import { useEffect, useReducer } from "react";
import { useAssignedProjects } from "@/lib/query/use-assigned-projects";
import {
	normalizeWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";
import {
	readLastProjectId,
	readLastWorkCategoryId,
} from "./selection-preferences";
import { useAvailableWorkCategories } from "./use-available-work-categories";

interface TimeClockPopoverState {
	showNotesInput: boolean;
	lastClockOutEntryId: string | null;
	notesText: string;
	selectedProjectId: string | undefined;
	selectedWorkCategoryId: string | undefined;
	workLocationType: WorkLocationType;
}

type TimeClockPopoverAction =
	| { type: "setNotesText"; value: string }
	| { type: "setSelectedProjectId"; value: string | undefined }
	| { type: "setSelectedWorkCategoryId"; value: string | undefined }
	| { type: "setWorkLocationType"; value: WorkLocationType }
	| { type: "openNotesInput"; entryId: string }
	| { type: "closeNotesInput" }
	| { type: "resetClockOutSelections" };

function getInitialWorkLocationType(): WorkLocationType {
	if (typeof window === "undefined") return "office";
	return normalizeWorkLocationType(
		localStorage.getItem("z8-work-location-type"),
	);
}

function createInitialState(): TimeClockPopoverState {
	return {
		showNotesInput: false,
		lastClockOutEntryId: null,
		notesText: "",
		selectedProjectId: undefined,
		selectedWorkCategoryId: undefined,
		workLocationType: getInitialWorkLocationType(),
	};
}

function timeClockPopoverReducer(
	state: TimeClockPopoverState,
	action: TimeClockPopoverAction,
): TimeClockPopoverState {
	switch (action.type) {
		case "setNotesText":
			return { ...state, notesText: action.value };
		case "setSelectedProjectId":
			return { ...state, selectedProjectId: action.value };
		case "setSelectedWorkCategoryId":
			return { ...state, selectedWorkCategoryId: action.value };
		case "setWorkLocationType":
			return { ...state, workLocationType: action.value };
		case "openNotesInput":
			return {
				...state,
				showNotesInput: true,
				lastClockOutEntryId: action.entryId,
				notesText: "",
			};
		case "closeNotesInput":
			return {
				...state,
				showNotesInput: false,
				lastClockOutEntryId: null,
				notesText: "",
			};
		case "resetClockOutSelections":
			return {
				...state,
				selectedProjectId: undefined,
				selectedWorkCategoryId: undefined,
			};
	}
}

export function useTimeClockPopoverState({
	employeeId,
	isClockedIn,
}: {
	employeeId: string | null | undefined;
	isClockedIn: boolean;
}) {
	const [uiState, dispatch] = useReducer(
		timeClockPopoverReducer,
		undefined,
		createInitialState,
	);
	const assignedProjects = useAssignedProjects({ enabled: isClockedIn });
	const availableWorkCategories = useAvailableWorkCategories(
		employeeId ?? "",
		isClockedIn && !!employeeId,
	);

	useEffect(() => {
		if (!isClockedIn) return;

		if (uiState.selectedProjectId === undefined) {
			const lastProjectId = readLastProjectId();
			if (
				lastProjectId &&
				assignedProjects.projects.some(
					(project) => project.id === lastProjectId,
				)
			) {
				dispatch({ type: "setSelectedProjectId", value: lastProjectId });
			}
		}

		if (uiState.selectedWorkCategoryId === undefined) {
			const lastWorkCategoryId = readLastWorkCategoryId();
			if (
				lastWorkCategoryId &&
				availableWorkCategories.categories.some(
					(category) => category.id === lastWorkCategoryId,
				)
			) {
				dispatch({
					type: "setSelectedWorkCategoryId",
					value: lastWorkCategoryId,
				});
			}
		}
	}, [
		assignedProjects.projects,
		availableWorkCategories.categories,
		isClockedIn,
		uiState.selectedProjectId,
		uiState.selectedWorkCategoryId,
	]);

	return { uiState, dispatch, assignedProjects, availableWorkCategories };
}
