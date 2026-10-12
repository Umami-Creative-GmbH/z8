"use client";

import { useTranslate } from "@tolgee/react";
import { useCallback } from "react";
import type { AssignedLocationErrorCode } from "@/lib/time-tracking/assigned-locations/errors";

/** Translates an assigned-location refusal code for a toast. */
export function useAssignedLocationErrorMessage() {
	const { t } = useTranslate();
	return useCallback(
		(code: AssignedLocationErrorCode | null): string => {
			switch (code) {
				case "admin_only":
					return t(
						"settings.assignedLocations.errors.adminOnly",
						"Only organization owners and admins can manage assigned locations.",
					);
				case "employee_not_found":
					return t("settings.assignedLocations.errors.employeeNotFound", "Employee not found.");
				case "location_not_found":
					return t("settings.assignedLocations.errors.locationNotFound", "Location not found.");
				case "invalid_selection":
					return t("settings.assignedLocations.errors.invalidSelection", "Choose from the list.");
				default:
					return t(
						"settings.assignedLocations.errors.failed",
						"Assigned locations could not be updated. Try again.",
					);
			}
		},
		[t],
	);
}
