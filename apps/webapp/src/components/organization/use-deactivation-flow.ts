"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { previewEmployeeDeactivation } from "@/app/[locale]/(app)/settings/employees/actions";
import { queryKeys } from "@/lib/query/keys";
import { useRequestIdentity } from "@/lib/query/use-employee-offboarding";
import type { DeactivationReplacementPicks } from "./deactivation-preview-dialog";
import { EmployeeLifecycleActionError } from "./employee-lifecycle-error";

/** What a confirmed Deactivate submits: the picks and the request ID for exactly them. */
export type DeactivationSubmission = {
	replacementManagers: DeactivationReplacementPicks;
	requestId: string;
};

/**
 * The state of Deactivate's preview dialog (#1440): the replacement picks the
 * preview is computed with, the server's preview for them, the refusal shown
 * in the dialog, and one request ID per unchanged payload so a retried submit
 * replays instead of deactivating twice. `employeeId` is null while the dialog
 * is closed; the preview loads only while it is open.
 */
export function useDeactivationFlow(employeeId: string | null) {
	const [picks, setPicks] = useState<DeactivationReplacementPicks>({});
	const [submitError, setSubmitError] = useState<string | null>(null);
	const identity = useRequestIdentity();
	const previewEmployeeId = employeeId ?? "";

	const preview = useQuery({
		queryKey: queryKeys.employees.deactivationPreview.withPicks(previewEmployeeId, picks),
		queryFn: async () => {
			const result = await previewEmployeeDeactivation({
				employeeId: previewEmployeeId,
				replacementManagers: picks,
			});
			if (!result.success) throw new EmployeeLifecycleActionError(result);
			return result.data;
		},
		enabled: employeeId !== null,
		// While new picks recalculate, keep showing this employee's last preview.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === previewEmployeeId ? keepPreviousData(previous) : undefined,
		staleTime: 0,
		retry: false,
	});

	return {
		/** The preview for the current picks, or this employee's last one while it recalculates. */
		plan: employeeId !== null ? (preview.data ?? null) : null,
		isLoading: preview.isFetching,
		/** The preview failed and there is nothing to show instead. */
		loadFailed: preview.isError && !preview.data,
		refetch: () => void preview.refetch(),
		submitError,
		setSubmitError,
		changePicks(next: DeactivationReplacementPicks) {
			setSubmitError(null);
			setPicks(next);
		},
		/** The submission for these picks; the same picks keep their request ID. */
		submission(next: DeactivationReplacementPicks): DeactivationSubmission {
			setSubmitError(null);
			return {
				replacementManagers: next,
				requestId: identity.forPayload({ employeeId, replacementManagers: next }),
			};
		},
		/** The server deactivated: the next payload gets a new request ID. */
		completed: () => identity.complete(),
		reset() {
			setPicks({});
			setSubmitError(null);
		},
	};
}
