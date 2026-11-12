"use client";

import { useTranslate } from "@tolgee/react";
import { useCallback } from "react";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { AssignedLocationErrorCode } from "@/lib/time-tracking/assigned-locations/errors";
import { ASSIGNED_LOCATION_REFUSALS } from "./assigned-location-refusals";

/** Translates an assigned-location refusal code for a toast. */
export function useAssignedLocationErrorMessage() {
	const { t } = useTranslate();
	return useCallback(
		(code: AssignedLocationErrorCode | null): string =>
			actionErrorMessage(
				t,
				{ code },
				ASSIGNED_LOCATION_REFUSALS,
				ASSIGNED_LOCATION_REFUSALS.failed,
			),
		[t],
	);
}
