import { useState } from "react";
import { isWorkLocationType, type WorkLocationType } from "../types";

const WORK_LOCATION_KEY = "z8-work-location-type";
const DEFAULT_WORK_LOCATION: WorkLocationType = "office";

function getStoredWorkLocation(): WorkLocationType {
  if (typeof window === "undefined") {
    return DEFAULT_WORK_LOCATION;
  }

  try {
    const storedValue = localStorage.getItem(WORK_LOCATION_KEY);
    return isWorkLocationType(storedValue) ? storedValue : DEFAULT_WORK_LOCATION;
  } catch {
    return DEFAULT_WORK_LOCATION;
  }
}

export function useWorkLocation() {
  const [workLocationType, setWorkLocationTypeState] = useState<WorkLocationType>(
    getStoredWorkLocation,
  );

  const setWorkLocationType = (nextWorkLocationType: WorkLocationType) => {
    setWorkLocationTypeState(nextWorkLocationType);

    try {
      localStorage.setItem(WORK_LOCATION_KEY, nextWorkLocationType);
    } catch {
      // Keep UI state usable when browser storage is unavailable.
    }
  };

  return { workLocationType, setWorkLocationType };
}
