import { useState } from "react";
import { isWorkLocationType, type WorkLocationType } from "../types";

const WORK_LOCATION_KEY = "z8-work-location-type";
const DEFAULT_WORK_LOCATION: WorkLocationType = "office";

function getStoredWorkLocation(key: string): WorkLocationType {
	if (typeof window === "undefined") {
		return DEFAULT_WORK_LOCATION;
	}

	try {
		const storedValue = localStorage.getItem(key);
		return isWorkLocationType(storedValue)
			? storedValue
			: DEFAULT_WORK_LOCATION;
	} catch {
		return DEFAULT_WORK_LOCATION;
	}
}

export function useWorkLocation(scope: string) {
	const key = `${WORK_LOCATION_KEY}:${scope}`;
	const [workLocationType, setWorkLocationTypeState] =
		useState<WorkLocationType>(() => getStoredWorkLocation(key));

	const setWorkLocationType = (nextWorkLocationType: WorkLocationType) => {
		setWorkLocationTypeState(nextWorkLocationType);

		try {
			localStorage.setItem(key, nextWorkLocationType);
		} catch {
			// Keep UI state usable when browser storage is unavailable.
		}
	};

	return { workLocationType, setWorkLocationType };
}
